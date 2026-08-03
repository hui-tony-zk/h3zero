import ast
import unittest
from pathlib import Path


class ModalServiceDefinitionTests(unittest.TestCase):
    def test_h3_uses_cpu_memory_snapshot_lifecycle(self):
        source = Path("modal_services/h3.py").read_text(encoding="utf-8")
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


if __name__ == "__main__":
    unittest.main()
