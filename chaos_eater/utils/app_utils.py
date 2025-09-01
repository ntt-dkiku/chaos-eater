from typing import Tuple

import redis
import streamlit as st
import streamlit.components.v1 as components

from .functions import type_cmd


#----------------
# util functions
#----------------
def apply_html(html: str, **kwargs) -> None:
    st.markdown(html, unsafe_allow_html=True, **kwargs)


# ref: https://discuss.streamlit.io/t/st-logo-image-size/71085/3
REMOVE_SIDEBAR_TOPSPACE = """\
<style>
    div[data-testid="stSidebarHeader"] > img, div[data-testid="collapsedControl"] > img {
        height: 3rem;
        width: auto;
    }
    div[data-testid="stSidebarHeader"], div[data-testid="stSidebarHeader"] > *,
    div[data-testid="collapsedControl"], div[data-testid="collapsedControl"] > * {
        display: flex;
        align-items: center;
    }
    .st-emotion-cache-ocqkz7.e1f1d6gn5 {
        margin-bottom: -30px;
    }
</style>
"""
def apply_remove_sidebar_topspace() -> None:
    apply_html(REMOVE_SIDEBAR_TOPSPACE)


REMOVE_EXAMPLE_BOTTOMSPACE = """\
<style>
    .st-emotion-cache-ocqkz7.e1f1d6gn5 {{
        margin-bottom: {px}px;
    }}
</style>
"""
def apply_remove_example_bottomspace(px: int = 0) -> None:
    apply_html(REMOVE_EXAMPLE_BOTTOMSPACE.format(px=px))


ADD_CHAOS_EATER_ICON = """\
<style>
    .relative{
        position: relative;
        width: 140px;
    }
    .frame {
        display: inline-block;
        background-color: transparent;
        border-radius: 50%;
        width: 140px;
        height: 140px;
    }
    .eye {
        display: inline-block;
        position: absolute;
        right: 45.5px;
        bottom: 53.5px;
        background-color: white;
        border-radius: 50%;
        width: 45px;
        height: 45px;
        z-index: 1;
    }
    .mask {
        overflow: hidden;
        position: absolute;
        right: 45.5px;
        bottom: 53.5px;
        border-radius: 50%;
        width: 46px;
        height: 46px;
        z-index: 4;
    }
    .eyelid {
        display: inline-block;
        position: absolute;
        right: 0px;
        bottom: 1px;
        background-color: black;
        border-radius: 50% 50% 0% 0%;
        width: 45px;
        height: 45px;
        z-index: 5;
        animation-name: blink, blink2;
        animation-duration: 5s, 10s;
        animation-timing-function: linear, linear;
        animation-iteration-count: 1, infinite;
        animation-direction: normal, normal;
    }
    .pupil {
        display: inline-block;
        position: absolute;
        right: 14px;
        bottom: 14px;
        background-color: black;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        z-index: 2;
    }
    .pupil_highlight {
        display: inline-block;
        position: absolute;
        right: 17px;
        bottom: 22px;
        background-color: white;
        border-radius: 50%;
        width: 6px;
        height: 6px;
        z-index: 3;
    }
    .chaoseater {
        position: absolute;
        right: -2px;
        bottom: 6px;
        z-index: 0;
        animation-name: rotation;
        animation-duration: 30s;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
        animation-direction: normal;
    }
    @keyframes rotation{
        0%{ transform:rotate(0);}
        100%{ transform:rotate(-360deg); }
    }
    @keyframes blink {
        0% { transform: translateY(-100%);} 
        96%{ transform: translateY(-100%);}
        98%{ transform: translateY(0%);}
        100%{ transform: translateY(-100%);}
    }
    @keyframes blink2 {
        0% { transform: translateY(-100%);} 
        96%{ transform: translateY(-100%);}
        98%{ transform: translateY(0%);}
        100%{ transform: translateY(-100%);}
    }
</style>
<div class="stApp stAppEmbeddingId-s6iibfbv121p st-emotion-cache-ffhzg2 erw9t6i1">

<script>
    document.addEventListener('mousemove', function(event) {
        const eyes = document.querySelectorAll('.eye');
        eyes.forEach(eye => {                      
            const rect = eye.getBoundingClientRect();
            const eyeCenterX = rect.left + rect.width / 2;
            const eyeCenterY = rect.top + rect.height / 2;
            const deltaX = event.clientX - eyeCenterX;
            const deltaY = event.clientY - eyeCenterY;
            const angle = Math.atan2(deltaY, deltaX);
            const distance = Math.min(Math.min(rect.width / 4, 20), Math.sqrt(deltaX * deltaX + deltaY * deltaY));
            const pupilX = distance * Math.cos(angle);
            const pupilY = distance * Math.sin(angle);
            const pupil = eye.querySelector('.pupil');
            const pupil_highlight = eye.querySelector('.pupil_highlight');
            pupil.style.transform = `translate(${pupilX}px, ${pupilY}px)`;
            pupil_highlight.style.transform = `translate(${pupilX}px, ${pupilY}px)`;
        });
    });
    document.addEventListener('mouseleave', function(event) {
        const eyes = document.querySelectorAll('.eye');
        eyes.forEach(eye => {                  
            const pupil = eye.querySelector('.pupil');
            const pupil_highlight = eye.querySelector('.pupil_highlight');
            pupil.style.transform = `translate(0px, 0px)`;
            pupil_highlight.style.transform = `translate(0px, 0px)`;
        });
    });
</script>
<center> 
    <div class="relative">
        <span class="eye"> 
            <span class="pupil"></span>
            <span class="pupil_highlight"></span>
        </span>
        <div class="mask">
            <span class="eyelid"></span>
        </div>
        <img src="data:image/png;base64,{chaoseater_png}" class="chaoseater" alt="ChaosEater" width="140" height="140"> 
        <span class="frame"> </span>
    </div>
</center>
</div>
"""
import base64
from pathlib import Path
def add_chaoseater_icon(icon_path: str) -> None:
    img_bytes = Path(icon_path).read_bytes()
    encoded_img = base64.b64encode(img_bytes).decode()
    components.html(ADD_CHAOS_EATER_ICON.replace("{chaoseater_png}", f"{encoded_img}"))


# ref: https://discuss.streamlit.io/t/remove-hide-running-man-animation-on-top-of-page/21773/3
HIDE_ST_STYLE = """\
<style>
    div[data-testid="stToolbar"] {
        visibility: hidden;
        height: 0%;
        position: fixed;
    }
    div[data-testid="stDecoration"] {
        visibility: hidden;
        height: 0%;
        position: fixed;
    }
    div[data-testid="stStatusWidget"] {
        visibility: hidden;
        height: 0%;
        position: fixed;
    }
    #MainMenu {
        visibility: hidden;
        height: 0%;
    }
    header {
        visibility: hidden;
        height: 0%;
    }
    footer {
        visibility: hidden;
        height: 0%;
    }
</style>
"""
def apply_hide_st_style() -> None:
    apply_html(HIDE_ST_STYLE)

# ref: https://github.com/streamlit/streamlit/issues/6605
HIDE_HEIGHT0_COMPONENTS = """\
<style>
    .element-container:has(iframe[height="0"]) {{
        display: none;
    }}
</style>
"""
def apply_hide_height0_components():
    apply_html(HIDE_HEIGHT0_COMPONENTS)

CENTERIZE_COMPONENTS_VERTICALLY = """\
<style>
    [data-testid="stHorizontalBlock"] {
        align-items: center;
    }
</style>
"""
def apply_centerize_components_vertically():
    apply_html(CENTERIZE_COMPONENTS_VERTICALLY)

AUTO_SCROLL = """\
<script>
    const chatContainer = document.querySelector(".stChatContainer");
    let autoScrollEnabled = true;

    if (chatContainer) {
        chatContainer.addEventListener('scroll', () => {
            autoScrollEnabled = chatContainer.scrollTop + chatContainer.clientHeight >= chatContainer.scrollHeight;
        });

        const observer = new MutationObserver(() => {
            if (autoScrollEnabled) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        });

        observer.observe(chatContainer, { childList: true });
    }
</script>
"""
def apply_enable_auto_scroll():
    apply_html(AUTO_SCROLL)


# stand-alone spiner in streamlit
# ref: https://github.com/streamlit/streamlit/issues/6799
# Thank the authors for the excelent hack
class st_spinner:
    def __init__(self, text = "In progress..."):
        self.text = text
        self._spinner = iter(self._start()) # This creates an infinite spinner
        next(self._spinner) #  This starts it
        
    def _start(self):
        with st.spinner(self.text):
            yield 
    
    def end(self, text: str = None): # This ends it
        next(self._spinner, None)
        if text is not None:
            st.write(text)

# ref: https://discuss.streamlit.io/t/detecting-user-exit-browser-tab-closed-session-end/62066
import threading
from streamlit.runtime.scriptrunner import add_script_run_ctx
from streamlit.runtime.scriptrunner.script_run_context import get_script_run_ctx
from streamlit.runtime import get_instance
def monitor_session(session_id: str) -> None:
    thread = threading.Timer(interval=2, function=monitor_session, args=(session_id,) )
    add_script_run_ctx(thread)
    ctx = get_script_run_ctx()     
    runtime = get_instance()
    if runtime.is_active_session(session_id=ctx.session_id):
        thread.start()
    else:
        r = redis.Redis(host='localhost', port=6379, db=0)
        r.hdel("cluster_usage", session_id)
        return

def get_available_clusters(session_id: str) -> Tuple[str]:
    # get the cluster list
    cluster_str = type_cmd("kubectl config get-contexts | awk 'NR>1 {print $2}'", widget=False)
    cluster_list = tuple(cluster_str.strip().split("\n"))

    # get the available cluster list
    r = redis.Redis(host='localhost', port=6379, db=0)
    cluster_usage = r.hgetall("cluster_usage")
    used_cluster_list = tuple(v.decode() for v in cluster_usage.values())
    
    # cluster used by this session
    my_cluster = cluster_usage.get(session_id.encode())
    my_cluster = my_cluster.decode() if my_cluster else None

    # available clusters = unused ones + my own
    available = set(cluster_list) - set(used_cluster_list)
    if my_cluster:
        available.add(my_cluster)

    return tuple(sorted(available))