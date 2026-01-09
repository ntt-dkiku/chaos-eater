import os
from PIL import Image
import numpy as np

# Get project root directory (relative to this file: chaos_eater/utils/constants.py -> project root)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SKAFFOLD_YAML_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/skaffold/templates/skaffold_yaml_template.j2")
UNITTEST_BASE_PY_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/k8s/unittest_base.py")
K6_POD_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/k6/templates/k6_pod_template.j2")
K8S_POD_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/k8s/templates/k8s_pod_template.j2")
META_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/chaosmesh/templates/workflow_meta_template.j2")
TASK_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/chaosmesh/templates/task_template.j2")
TASK_K6_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/chaosmesh/templates/task_k6_template.j2")
FAULT_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/chaosmesh/templates/fault_template.j2")
GROUNDCHILDREN_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/chaosmesh/templates/groundchildren_template.j2")
SUSPEND_TEMPLATE_PATH = os.path.join(_PROJECT_ROOT, "chaos_eater/ce_tools/chaosmesh/templates/suspend_template.j2")

CHAOSEATER_LOGO_PATH = os.path.join(_PROJECT_ROOT, "docs/static/images/chaoseater_logo.png")
CHAOSEATER_IMAGE_PATH = os.path.join(_PROJECT_ROOT, "docs/static/images/chaoseater_icon.png")
CHAOSEATER_IMAGE = Image.open(CHAOSEATER_IMAGE_PATH)
CHAOSEATER_ICON = np.array(CHAOSEATER_IMAGE)

K8S_VALIDATION_VERSION = "1.27"