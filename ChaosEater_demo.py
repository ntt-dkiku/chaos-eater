import os
import time
import yaml
import zipfile
import subprocess
import pickle
from pathlib import Path

import streamlit as st
import redis
from streamlit.runtime.scriptrunner.script_run_context import get_script_run_ctx
from streamlit_extras.bottom_container import bottom

import chaos_eater.utils.app_utils as app_utils
from chaos_eater.chaos_eater import ChaosEater, ChaosEaterInput
from chaos_eater.ce_tools.ce_tool import CEToolType, CETool
from chaos_eater.utils.llms import load_llm, check_existing_key, get_env_key_name
from chaos_eater.utils.functions import get_timestamp, type_cmd, is_binary
from chaos_eater.utils.k8s import remove_all_resources_by_namespace
from chaos_eater.utils.schemas import File
from chaos_eater.utils.constants import CHAOSEATER_IMAGE_PATH, CHAOSEATER_LOGO_PATH, CHAOSEATER_ICON, CHAOSEATER_IMAGE
from chaos_eater.utils.exceptions import ModelNotFoundError
from chaos_eater.utils.streamlit import StreamlitLogger, StreamlitUsageDisplayCallback


# for debug
from langchain.globals import set_verbose
import langchain
langchain.debug = True
set_verbose(True)

WORK_DIR  = "sandbox"
NAMESPACE = "chaos-eater"
EXAMPLE_DIR = "./examples"


REQUEST_URL_INSTRUCTIONS = """
- When using k6 in steady-state definition, always select a request URL from the following options (other requests are invalid):
  1. http://front-end.sock-shop.svc.cluster.local/
  2. http://front-end.sock-shop.svc.cluster.local/catalogue?size=10
  3. http://front-end.sock-shop.svc.cluster.local/detail.html?id=<ID>
  Replace <ID> with an available ID: [`03fef6ac-1896-4ce8-bd69-b798f85c6e0b`, `3395a43e-2d88-40de-b95f-e00e1502085b`, `510a0d7e-8e83-4193-b483-e27e09ddc34d`, `808a2de1-1aaa-4c25-a9b9-6612e8f29a38`, `819e1fbf-8b7e-4f6d-811f-693534916a8b`, `837ab141-399e-4c1f-9abc-bace40296bac`, `a0a4f044-b040-410d-8ead-4de0446aec7e`, `d3588630-ad8e-49df-bbd7-3167f7efb246`, `zzz4f044-b040-410d-8ead-4de0446aec7e`]
  4. http://front-end.sock-shop.svc.cluster.local/category/
  5. http://front-end.sock-shop.svc.cluster.local/category?tags=<TAG>
  Replace <TAG> with an available tag: [`magic`, `action`, `blue`, `brown`, `black`, `sport`, `formal`, `red`, `green`, `skin`, `geek`]
  6. http://front-end.sock-shop.svc.cluster.local/basket.html"""


@st.experimental_dialog("Confirm Pulling Model")
def pull_model(model_name: str):
    st.write(f"The specified model: {model_name} was not found in the available model list. Do you want to pull it?")
    if st.button("Pull the model"):
        print(f"{model_name}")
        subprocess.run(
            ["docker", "exec", "-it", "ollama", "ollama", "pull", model_name.split("ollama/", 1)[1]],
            check=True
        )
        st.rerun()

def init_choaseater(
    model_name: str = "openai/gpt-4o",
    temperature: float = 0.0,
    port: int = 8000,
    seed: int = 42
) -> None:
    provider = model_name.split("/")[0]
    if provider in ["openai", "anthropic", "google"]:
        if st.session_state.api_key != "":
            os.environ[get_env_key_name(provider)] = st.session_state.api_key
    try:
        llm = load_llm(
            model_name=model_name, 
            temperature=temperature,
            port=port,
            seed=seed
        )
    except ModelNotFoundError:
        pull_model(model_name)
        llm = load_llm(
            model_name=model_name, 
            temperature=temperature,
            port=port,
            seed=seed
        )

    st.session_state.chaoseater = ChaosEater(
        llm=llm,
        message_logger=st.session_state.message_logger,
        ce_tool=CETool.init(CEToolType.chaosmesh),
        work_dir=WORK_DIR,
        namespace=NAMESPACE
    )
    st.session_state.model_name = model_name
    st.session_state.temperature = temperature
    st.session_state.seed = seed

def find_message_logs(root: str = "."):
    logs = {}
    for entry in os.listdir(root):
        cycle_path = os.path.join(root, entry)
        if os.path.isdir(cycle_path):
            target = os.path.join(cycle_path, "outputs", "message_log.pkl")
            if os.path.exists(target):
                logs[entry] = target
    return logs

def create_cycle_dir(cycle_name: str):
    os.makedirs(f"{WORK_DIR}/{cycle_name}/outputs", exist_ok=False)
    with open(f"{WORK_DIR}/{cycle_name}/outputs/message_log.pkl", "wb") as f:
        pickle.dump([], f)


def main():
    #---------------------------
    # initialize session states
    #---------------------------
    if "state_list" not in st.session_state:
        st.session_state.state_list = {}
    if "session_id" not in st.session_state:
        session_ctx = get_script_run_ctx()
        st.session_state.session_id = session_ctx.session_id
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []
    if "count" not in st.session_state:
        st.session_state.count = 0
    if "is_first_run" not in st.session_state:
        st.session_state.is_first_run = True
    if "input" not in st.session_state:
        st.session_state.input = None
    if "submit" not in st.session_state:
        st.session_state.submit = False
    if "resume" not in st.session_state:
        st.session_state.resume = False
    if "stop" not in st.session_state:
        st.session_state.stop = False
    if "model_name" not in st.session_state:
        st.session_state.model_name = "openai/gpt-4o-2024-08-06"
    if "seed" not in st.session_state:
        st.session_state.seed = 42
    if "temperature" not in st.session_state:
        st.session_state.temperature = 0.0
    if "message_logger" not in st.session_state:
        st.session_state.message_logger = StreamlitLogger()
    if "selected_cycle" not in st.session_state:
        st.session_state.selected_cycle = ""
    
    #--------------
    # CSS settings
    #--------------
    st.set_page_config(
        page_title="ChaosEater",
        page_icon=CHAOSEATER_IMAGE,
        # layout="wide"
    )
    app_utils.apply_hide_st_style()
    app_utils.apply_hide_height0_components()
    app_utils.apply_centerize_components_vertically()
    app_utils.apply_remove_sidebar_topspace()
    app_utils.apply_enable_auto_scroll()
    
    #---------
    # sidebar
    #---------
    st.logo(CHAOSEATER_LOGO_PATH)
    with st.sidebar:
        #------------------
        # general settings
        #------------------
        with st.expander("General settings", expanded=True):
            #-----------------
            # model selection
            #-----------------
            selected_model = st.selectbox(
                "Model", 
                (
                    "openai/gpt-4o-2024-08-06",
                    "google/gemini-1.5-pro-latest",
                    "anthropic/claude-3-5-sonnet-20241022",
                    "ollama/qwen3:32b",
                    "custom"
                )
            )
            if selected_model == "custom":
                model_name = st.text_input("Enter custom model name", placeholder="ollama/gpt-oss:120b")
                if model_name is None:
                    model_name = "openai/gpt-4o-2024-08-06"
            else:
                model_name = selected_model
            if model_name.startswith(("openai", "google", "anthropic")):
                provider = model_name.split("/")[0]
                has_valid_key = check_existing_key(provider)
                if has_valid_key:
                    help_text = f"A valid {provider.capitalize()} API key is already set"
                else:
                    help_text = f"Enter your {provider.capitalize()} API key"
                st.text_input(
                    label="API key",
                    key="api_key",
                    placeholder=help_text,
                    type="password"
                )
            
            #-------------------
            # cluster selection
            #-------------------
            avail_cluster_list = app_utils.get_available_clusters(st.session_state.session_id)
            FULL_CAP_MSG = "No clusters available right now. Please wait until a cluster becomes available."
            if len(avail_cluster_list) == 0:
                avail_cluster_list = (FULL_CAP_MSG,)
            cluster_name = st.selectbox(
                "Cluster selection",
                avail_cluster_list,
                key="cluster_name"
            )
            app_utils.monitor_session(st.session_state.session_id)
            st.button(
                "Clean the cluster",
                key="clean_k8s",
                on_click=remove_all_resources_by_namespace,
                args=(cluster_name, NAMESPACE, )
            )

            #--------------------
            # parameter settings
            #--------------------
            clean_cluster_before_run = st.checkbox("Clean the cluster before run", value=True)
            clean_cluster_after_run = st.checkbox("Clean the cluster after run", value=True)
            is_new_deployment = st.checkbox("New deployment", value=True)
            seed = st.number_input("Seed for LLMs", 42)
            temperature = st.number_input("Temperature for LLMs", 0.0)
            max_num_steadystates = st.number_input("Max. number of steady states", 3)
            max_retries = st.number_input("Max retries", 3)

        #---------------------------
        # usage: tokens and billing
        #---------------------------
        with st.expander("Usage", expanded=True):
            st.session_state.usage_displayer = StreamlitUsageDisplayCallback(model_name)
        
        #-----------------
        # command history
        #-----------------
        if not st.session_state.is_first_run:
            st.write("Command history")
        
        #-------------------
        # history of cycles
        #-------------------
        with st.expander("### Cycles", expanded=True):
            # create new cycle
            col1, col2 = st.columns(2)
            with col1:
                new_cycle_name = st.text_input(
                    "Create new cycles",
                    value="cycles_1",
                    label_visibility="collapsed"
                )
            with col2:
                if st.button("New cycles", use_container_width=True):
                    st.session_state.selected_cycle = new_cycle_name
                    create_cycle_dir(new_cycle_name)
                    st.rerun()

            # created cycles
            clicked_cycle = None
            logs = find_message_logs(WORK_DIR)
            sorted_logs = sorted(
                logs.items(),
                key=lambda x: os.path.getmtime(x[1]),
                reverse=True
            )
            for name, path in sorted_logs:
                if st.button(
                    name,
                    key=name,
                    use_container_width=True,
                    type="primary" if st.session_state.selected_cycle == name else "secondary"
                ):
                    clicked_cycle = (name, path)

    if clicked_cycle:
        name, path = clicked_cycle
        if os.path.exists(Path(path).with_name("output.json")):
            st.session_state.message_logger = StreamlitLogger.load(path)
            st.session_state.usage_displayer.load(Path(path).with_name("output.json"))
            st.session_state.is_first_run = False
        else:
            st.session_state.message_logger = StreamlitLogger()
            st.session_state.usage_displayer = StreamlitUsageDisplayCallback(model_name)
            st.session_state.is_first_run = True
        st.session_state.selected_cycle = name
        st.rerun()

    #------------------------
    # initialize chaos eater
    #------------------------
    # initialization
    if (
        "chaoseater" not in st.session_state
        or model_name != st.session_state.model_name
        or seed != st.session_state.seed
        or temperature != st.session_state.temperature
    ):
        init_choaseater(
            model_name=model_name,
            seed=seed,
            temperature=temperature
        )

    # greeding 
    if len(st.session_state.chat_history) == 0 and st.session_state.is_first_run:
        app_utils.add_chaoseater_icon(CHAOSEATER_IMAGE_PATH)
        if st.session_state.count == 0: # streaming
            greeding = "Let's dive into Chaos together :)"
            elem = st.empty()
            words = ""
            for word in list(greeding):
                if word == "C":
                    words += "<font color='#7fff00'>" + word
                elif word == "s":
                    words += word + "</font>"
                else:
                    words += word
                elem.markdown(f'<center> <h3> {words} </h3> </center>', unsafe_allow_html=True)
                time.sleep(0.06)
        else:
            greeding = "Let's dive into <font color='#7fff00'>Chaos</font> together :)"
            st.markdown(f'<center> <h3> {greeding} </h3> </center>', unsafe_allow_html=True)

    #----------
    # examples
    #----------
    def submit_example(number: int, example_dir: str, instructions: str) -> None:
        decorated_func = st.experimental_dialog(f"Example input #{number}")(submit_example_internal)
        decorated_func(example_dir, instructions)

    def submit_example_internal(example_dir: str, instructions: str) -> None:
        # load the project
        skaffold_yaml = None
        project_files_tmp = []
        for root, _, files in os.walk(example_dir):
            for entry in files:
                fpath = os.path.join(root, entry)
                if os.path.isfile(fpath):
                    with open(fpath, "rb") as f:
                        file_content = f.read()
                    if is_binary(file_content):
                        content = file_content
                    else:
                        content = file_content.decode('utf-8')
                    if os.path.basename(fpath) == "skaffold.yaml":
                        skaffold_yaml = File(
                            path=fpath,
                            content=content,
                            work_dir=EXAMPLE_DIR,
                            fname=fpath.removeprefix(f"{EXAMPLE_DIR}/")
                        )
                    else:
                        project_files_tmp.append(File(
                                path=fpath,
                                content=content,
                                work_dir=EXAMPLE_DIR,
                                fname=fpath.removeprefix(f"{EXAMPLE_DIR}/")
                        ))
        input_tmp = ChaosEaterInput(
            skaffold_yaml=skaffold_yaml,
            files=project_files_tmp,
            ce_instructions=instructions
        )
        skaffold_yaml_dir = os.path.dirname(skaffold_yaml.path)
        k8s_yamls_tmp = []
        for k8s_yaml_fname in yaml.safe_load(skaffold_yaml.content)["manifests"]["rawYaml"]:
            for file in project_files_tmp:
                if f"{skaffold_yaml_dir}/{k8s_yaml_fname}" == file.path:
                    k8s_yamls_tmp.append(File(
                        path=file.path,
                        content=file.content,
                        fname=file.fname
                    ))
        # display the example
        st.write("### Input K8s manifest(s):")
        for k8s_yaml in k8s_yamls_tmp:
            st.write(f"```{k8s_yaml.fname}```")
            st.code(k8s_yaml.content)
        st.write("### Instructions:")
        st.write(instructions)
        with st.columns(3)[1]:
            # submit the example
            if st.button("Try this one"):
                st.session_state.input = input_tmp
                st.session_state.submit = True
                st.rerun()

    if st.session_state.is_first_run:
        app_utils.apply_remove_example_bottomspace(px=0)
        st.session_state.bottom_container = bottom()
        with st.session_state.bottom_container:
            #----------
            # examples
            #----------
            col1, col2, col3 = st.columns(3)
            with col1:
                if st.button(
                    "example#1:  \nNginx w/ detailed CE instructions",
                    key="example1",
                    use_container_width=True
                ):
                    submit_example(
                        number=1,
                        example_dir=f"{EXAMPLE_DIR}/nginx",
                        instructions="- The Chaos-Engineering experiment must be completed within 1 minute.\n- List ONLY one steady state about Pod Count.\n- Conduct pod-kill"
                    )
            with col2:
                if st.button(
                    "example#2:  \nNginx w/ limited experiment duration",
                    key="example2",
                    use_container_width=True
                ):
                    submit_example(
                        number=2,
                        example_dir=f"{EXAMPLE_DIR}/nginx",
                        instructions="The Chaos-Engineering experiment must be completed within 1 minute."
                    )
            with col3:
                if st.button(
                    "example#3:  \nSock shop w/ limited experiment duration",
                    key="example3",
                    use_container_width=True
                ):
                    submit_example(
                        number=3,
                        example_dir=f"{EXAMPLE_DIR}/sock-shop-2",
                        instructions=f"- The Chaos-Engineering experiment must be completed within 1 minute.\n{REQUEST_URL_INSTRUCTIONS}"
                    )
            #----------------
            # file uploading
            #----------------
            upload_col, submit_col = st.columns([10, 2], vertical_alignment="bottom")
            with upload_col:
                file = st.file_uploader(
                    "upload your project",
                    type="zip",
                    accept_multiple_files=False,
                    label_visibility="hidden"
                )
                if file is not None:
                    project_files_tmp = []
                    with zipfile.ZipFile(file, "r") as z:
                        for file_info in z.infolist():
                            # only process files, skip directories
                            if not file_info.is_dir():
                                with z.open(file_info) as file:
                                    file_content = file.read()
                                    if is_binary(file_content):
                                        content = file_content
                                    else:
                                        content = file_content.decode('utf-8')
                                    fpath = file_info.filename
                                    if os.path.basename(fpath) == "skaffold.yaml":
                                        skaffold_yaml = File(
                                            path=fpath,
                                            content=content,
                                            work_dir=EXAMPLE_DIR,
                                            fname=fpath.removeprefix(EXAMPLE_DIR)
                                        )
                                    else:
                                        project_files_tmp.append(File(
                                                path=fpath,
                                                content=content,
                                                work_dir=EXAMPLE_DIR,
                                                fname=fpath.removeprefix(EXAMPLE_DIR)
                                        ))
                    st.session_state.input = ChaosEaterInput(
                        skaffold_yaml=skaffold_yaml,
                        files=project_files_tmp
                    )
            with submit_col:
                st.text("")
                if st.button("Submit w/o instructions", key="submit_"):
                    if st.session_state.input != None:
                        st.session_state.input.ce_instructions = ""
                        st.session_state.submit = True
                        st.rerun()
                st.text("")
    else:
        app_utils.apply_remove_example_bottomspace()

    #--------------
    # chat history
    #--------------
    st.session_state.message_logger.display_history()

    #--------------------------
    # place stop/resume button
    #--------------------------
    with bottom():
        with st.columns(3)[1]:
            stop_resume_button = st.empty()

    #------------------------
    # resume a stopped cycle
    #------------------------
    if "stop" in st.session_state:
        if st.session_state.stop:
            if stop_resume_button.button("⏹ Resume", key="resume", use_container_width=True):
                st.session_state.stop = False
                st.rerun()

    #--------------
    # current chat
    #--------------
    prompt = st.chat_input(
        placeholder="Input instructions for your Chaos Engineering",
        key="chat_input"
    )
    if prompt or st.session_state.submit or st.session_state.resume:        
        if "chaoseater" in st.session_state and cluster_name != FULL_CAP_MSG:
            if st.session_state.input:
                # refresh the screen at the first run
                if st.session_state.is_first_run:
                    st.session_state.is_first_run = False
                    if prompt:
                        st.session_state.input.ce_instructions = prompt
                        st.session_state.submit = True
                    if st.session_state.selected_cycle == "":
                        cycle_datetime = f"cycle_{get_timestamp()}"
                        st.session_state.selected_cycle = cycle_datetime
                        create_cycle_dir(cycle_datetime)
                    st.rerun()
                input = st.session_state.input
                if prompt:
                    input.ce_instructions = prompt
                st.session_state.submit = False
                st.session_state.resume = False

                #---------------------
                # display user inputs
                #---------------------
                with st.chat_message("user"):
                    st.session_state.message_logger.write("##### Your instructions for Chaos Engineering:", role="user")
                    st.session_state.message_logger.write(input.ce_instructions, role="user")
                
                #---------------------
                # chaoseater response
                #---------------------
                # set the currrent cluster
                if len(avail_cluster_list) > 0 and avail_cluster_list[0] != FULL_CAP_MSG:
                    r = redis.Redis(host='localhost', port=6379, db=0)
                    r.hset("cluster_usage", st.session_state.session_id, cluster_name)
                
                # display stop button
                stop_resume_button.button("⏹ Stop", use_container_width=True, key="stop")

                # response
                with st.chat_message("assistant", avatar=CHAOSEATER_ICON):
                    output = st.session_state.chaoseater.run_ce_cycle(
                        input=input,
                        work_dir=f"{WORK_DIR}/{st.session_state.selected_cycle}",
                        kube_context=cluster_name,
                        is_new_deployment=is_new_deployment,
                        clean_cluster_before_run=clean_cluster_before_run,
                        clean_cluster_after_run=clean_cluster_after_run,
                        max_num_steadystates=max_num_steadystates,
                        max_retries=max_retries,
                        callbacks=[st.session_state.usage_displayer]
                    )
                    # download output
                    output_dir = output.work_dir
                    os.makedirs("./temp", exist_ok=True) 
                    zip_path = f"./temp/{os.path.basename(output_dir)}.zip"
                    print(type_cmd(f"zip -r {zip_path} {output_dir}"))
                    with open(zip_path, "rb") as fp:
                        btn = st.download_button(
                            label="Download output (.zip)",
                            data=fp,
                            file_name=f"{os.path.basename(zip_path)}",
                            mime=f"output/zip"
                        )
                stop_resume_button.write()
            else:
                with st.chat_message("assistant", avatar=CHAOSEATER_ICON):
                    st.session_state.message_logger.write("Please input your k8s mainfests!")
        else:
            if cluster_name == FULL_CAP_MSG:
                with st.chat_message("assistant", avatar=CHAOSEATER_ICON):
                    st.session_state.message_logger.write(FULL_CAP_MSG)
            else:
                with st.chat_message("assistant", avatar=CHAOSEATER_ICON):
                    st.session_state.message_logger.write("Please set your API key!")

    st.session_state.count += 1

if __name__ == "__main__":
    main()