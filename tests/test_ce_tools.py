"""Unit tests for chaos_eater/ce_tools/"""
import pytest


class TestCEToolType:
    """Tests for CEToolType enum"""

    def test_chaosmesh_value(self):
        from chaos_eater.ce_tools.ce_tool import CEToolType
        assert CEToolType.chaosmesh.value == "chaosmesh"

    def test_enum_members(self):
        from chaos_eater.ce_tools.ce_tool import CEToolType
        members = list(CEToolType)
        assert len(members) >= 1
        assert CEToolType.chaosmesh in members


class TestCETool:
    """Tests for CETool factory class"""

    def test_init_chaosmesh(self):
        from chaos_eater.ce_tools.ce_tool import CETool, CEToolType
        from chaos_eater.ce_tools.chaosmesh.chaosmesh import ChaosMesh

        tool = CETool.init(CEToolType.chaosmesh)
        assert isinstance(tool, ChaosMesh)

    def test_init_invalid_tool(self):
        from chaos_eater.ce_tools.ce_tool import CETool

        with pytest.raises(TypeError, match="Invalid chaos tool"):
            CETool.init("invalid_tool")

    def test_factory_map_exists(self):
        from chaos_eater.ce_tools.ce_tool import CETool, CEToolType

        assert CEToolType.chaosmesh in CETool.FACTORY_MAP


class TestSelectors:
    """Tests for Selectors schema"""

    def test_selectors_with_namespaces(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        selector = Selectors(namespaces=["default", "chaos-eater"])
        assert selector.namespaces == ["default", "chaos-eater"]

    def test_selectors_with_label_selectors(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        selector = Selectors(labelSelectors={"app": "nginx", "tier": "frontend"})
        assert selector.labelSelectors == {"app": "nginx", "tier": "frontend"}

    def test_selectors_with_expression_selectors(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors, SetBasedRequirements

        selector = Selectors(
            expressionSelectors=[
                SetBasedRequirements(key="tier", operator="In", values=["cache"])
            ]
        )
        assert len(selector.expressionSelectors) == 1
        assert selector.expressionSelectors[0].key == "tier"

    def test_selectors_with_pods(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        selector = Selectors(pods={"default": ["pod-0", "pod-1"]})
        assert "default" in selector.pods
        assert len(selector.pods["default"]) == 2

    def test_selectors_empty(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        selector = Selectors()
        assert selector.namespaces is None
        assert selector.labelSelectors is None


class TestSetBasedRequirements:
    """Tests for SetBasedRequirements schema"""

    def test_in_operator(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import SetBasedRequirements

        req = SetBasedRequirements(
            key="environment",
            operator="In",
            values=["production", "staging"]
        )
        assert req.key == "environment"
        assert req.operator == "In"
        assert len(req.values) == 2

    def test_exists_operator(self):
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import SetBasedRequirements

        req = SetBasedRequirements(
            key="app",
            operator="Exists",
            values=[]
        )
        assert req.operator == "Exists"


class TestPodChaos:
    """Tests for PodChaos schema"""

    def test_pod_kill_action(self):
        from chaos_eater.ce_tools.chaosmesh.faults.pod_chaos import PodChaos
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = PodChaos(
            action="pod-kill",
            mode="one",
            selector=Selectors(namespaces=["default"])
        )
        assert chaos.action == "pod-kill"
        assert chaos.mode == "one"

    def test_container_kill_action(self):
        from chaos_eater.ce_tools.chaosmesh.faults.pod_chaos import PodChaos
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = PodChaos(
            action="container-kill",
            mode="all",
            selector=Selectors(namespaces=["default"]),
            containerNames=["nginx"]
        )
        assert chaos.action == "container-kill"
        assert chaos.containerNames == ["nginx"]

    def test_mode_options(self):
        from chaos_eater.ce_tools.chaosmesh.faults.pod_chaos import PodChaos
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        for mode in ["one", "all", "fixed", "fixed-percent", "random-max-percent"]:
            chaos = PodChaos(
                action="pod-kill",
                mode=mode,
                selector=Selectors(namespaces=["default"])
            )
            assert chaos.mode == mode

    def test_with_value(self):
        from chaos_eater.ce_tools.chaosmesh.faults.pod_chaos import PodChaos
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = PodChaos(
            action="pod-kill",
            mode="fixed-percent",
            value="50",
            selector=Selectors(namespaces=["default"])
        )
        assert chaos.value == "50"


class TestNetworkChaos:
    """Tests for NetworkChaos schema"""

    def test_delay_action(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import NetworkChaos, Deplay
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = NetworkChaos(
            action="delay",
            mode="all",
            selector=Selectors(namespaces=["default"]),
            delay=Deplay(latency="100ms", jitter="10ms")
        )
        assert chaos.action == "delay"
        assert chaos.delay.latency == "100ms"

    def test_loss_action(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import NetworkChaos, Loss
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = NetworkChaos(
            action="loss",
            mode="one",
            selector=Selectors(namespaces=["default"]),
            loss=Loss(loss="30", correlation="25")
        )
        assert chaos.action == "loss"
        assert chaos.loss.loss == "30"

    def test_bandwidth_action(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import NetworkChaos, Bandwidth
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = NetworkChaos(
            action="bandwidth",
            mode="all",
            selector=Selectors(namespaces=["default"]),
            bandwidth=Bandwidth(rate="1mbps", limit=100, buffer=100)
        )
        assert chaos.action == "bandwidth"
        assert chaos.bandwidth.rate == "1mbps"

    def test_direction_options(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import NetworkChaos
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        for direction in ["from", "to", "both"]:
            chaos = NetworkChaos(
                action="partition",
                mode="one",
                direction=direction,
                selector=Selectors(namespaces=["default"])
            )
            assert chaos.direction == direction

    def test_external_targets(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import NetworkChaos
        from chaos_eater.ce_tools.chaosmesh.faults.selectors import Selectors

        chaos = NetworkChaos(
            action="partition",
            mode="all",
            direction="to",
            selector=Selectors(namespaces=["default"]),
            externalTargets=["1.1.1.1", "www.google.com"]
        )
        assert len(chaos.externalTargets) == 2


class TestDelay:
    """Tests for Delay schema"""

    def test_basic_delay(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Deplay

        delay = Deplay(latency="50ms")
        assert delay.latency == "50ms"

    def test_delay_with_jitter(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Deplay

        delay = Deplay(latency="100ms", jitter="20ms")
        assert delay.latency == "100ms"
        assert delay.jitter == "20ms"

    def test_delay_with_correlation(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Deplay

        delay = Deplay(latency="50ms", correlation="50")
        assert delay.correlation == "50"


class TestLoss:
    """Tests for Loss schema"""

    def test_basic_loss(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Loss

        loss = Loss(loss="25")
        assert loss.loss == "25"

    def test_loss_with_correlation(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Loss

        loss = Loss(loss="30", correlation="50")
        assert loss.loss == "30"
        assert loss.correlation == "50"


class TestCorrupt:
    """Tests for Corrupt schema"""

    def test_basic_corrupt(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Corrupt

        corrupt = Corrupt(corrupt="10")
        assert corrupt.corrupt == "10"


class TestDuplicate:
    """Tests for Duplicate schema"""

    def test_basic_duplicate(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Duplicate

        dup = Duplicate(duplicate="15")
        assert dup.duplicate == "15"


class TestBandwidth:
    """Tests for Bandwidth schema"""

    def test_basic_bandwidth(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Bandwidth

        bw = Bandwidth(rate="10mbps", limit=1000, buffer=1000)
        assert bw.rate == "10mbps"
        assert bw.limit == 1000
        assert bw.buffer == 1000

    def test_bandwidth_with_optional_fields(self):
        from chaos_eater.ce_tools.chaosmesh.faults.network_chaos import Bandwidth

        bw = Bandwidth(rate="1gbps", limit=100, buffer=100, peakrate=1000, minburst=500)
        assert bw.peakrate == 1000
        assert bw.minburst == 500
