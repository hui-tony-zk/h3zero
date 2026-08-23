import ast
import unittest
from pathlib import Path


class ModalServiceDefinitionTests(unittest.TestCase):
    def test_gpu_worker_and_public_web_are_separate_apps(self):
        config = Path("minimax_h3/config.py").read_text(encoding="utf-8")
        gpu_source = Path("modal_services/h3_gpu.py").read_text(encoding="utf-8")
        web_source = Path("modal_services/h3.py").read_text(encoding="utf-8")

        self.assertIn('WEB_APP_NAME = "minimax-h3"', config)
        self.assertIn('GPU_APP_NAME = "minimax-h3-gpu"', config)
        self.assertIn("app = modal.App(GPU_APP_NAME)", gpu_source)
        self.assertIn("app = modal.App(WEB_APP_NAME)", web_source)
        self.assertIn("class H3Service", gpu_source)
        self.assertNotIn("class H3Service", web_source)
        self.assertNotIn("def web(", gpu_source)
        self.assertIn('modal.Cls.from_name(GPU_APP_NAME, "H3Service")', web_source)

    def test_deploy_scripts_keep_frontend_and_gpu_lifecycles_separate(self):
        deploy_source = Path("scripts/deploy/app.mjs").read_text(encoding="utf-8")
        command_source = Path("scripts/h3.mjs").read_text(encoding="utf-8")

        self.assertIn('"modal_services/h3.py"', deploy_source)
        self.assertIn('"modal_services/h3_gpu.py"', deploy_source)
        self.assertIn("await deployGpuApp(python);\n  await deployWebApp(python);", command_source)
        deploy_body = command_source.split("async function deploy()", 1)[1].split(
            "async function deployGpu()", 1
        )[0]
        self.assertIn("await deployWebApp(python);", deploy_body)
        self.assertNotIn("deployGpuApp", deploy_body)

    def test_gpu_dependencies_are_revision_pinned(self):
        source = Path("modal_services/h3_gpu.py").read_text(encoding="utf-8")
        self.assertIn(
            'COMFY_COMMIT = "2f35f4a08176d993cded35dac3332be4f7287f41"',
            source,
        )
        self.assertNotIn("ComfyUI-MiniMax-H3-Turbo", source)
        self.assertIn(
            'TURBO_REVISION = "e6346777701aa2b64d42ed058cdd71ae00e7cd52"',
            source,
        )
        self.assertIn('TURBO_REPO = "lightx2v/Minimax-h3-Turbo"', source)
        self.assertIn(
            'SPECTRUM_COMMIT = "567768f0de500ffbaf404dd9527c7a537819f7cd"',
            source,
        )
        self.assertIn("ComfyUI-Spectrum-MiniMax-H3", source)
        self.assertNotIn("SageAttention", source)
        self.assertIn('"loras",', source)

    def test_h3_uses_cpu_memory_snapshot_lifecycle(self):
        source = Path("modal_services/h3_gpu.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        service = next(
            node
            for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == "H3Service"
        )

        cls_decorator = next(
            decorator
            for decorator in service.decorator_list
            if isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Attribute)
            and decorator.func.attr == "cls"
        )
        keywords = {keyword.arg: keyword.value for keyword in cls_decorator.keywords}
        self.assertIsInstance(keywords["enable_memory_snapshot"], ast.Constant)
        self.assertTrue(keywords["enable_memory_snapshot"].value)
        self.assertNotIn("cpu", keywords)
        self.assertNotIn("memory", keywords)
        self.assertNotIn("experimental_options", keywords)

        enter_hooks = {}
        for node in service.body:
            if not isinstance(node, ast.FunctionDef):
                continue
            for decorator in node.decorator_list:
                if not (
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Attribute)
                    and decorator.func.attr == "enter"
                ):
                    continue
                snap = next(
                    keyword.value.value
                    for keyword in decorator.keywords
                    if keyword.arg == "snap" and isinstance(keyword.value, ast.Constant)
                )
                enter_hooks[node.name] = snap

        self.assertEqual(
            enter_hooks,
            {"prepare_snapshot": True, "boot": False},
        )

    def test_web_uses_minimum_resources_and_two_containers(self):
        source = Path("modal_services/h3.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        web = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "web"
        )
        function_decorator = next(
            decorator
            for decorator in web.decorator_list
            if isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Attribute)
            and decorator.func.attr == "function"
        )
        keywords = {keyword.arg: keyword.value for keyword in function_decorator.keywords}

        self.assertNotIn("cpu", keywords)
        self.assertNotIn("memory", keywords)
        self.assertEqual(keywords["max_containers"].value, 2)
        self.assertEqual(keywords["scaledown_window"].value, 15)


if __name__ == "__main__":
    unittest.main()
