import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

from minimax_h3.comfy import (
    COMFY_DIR,
    STALL_TIMEOUT_SECONDS,
    WEBSOCKET_TIMEOUT_SECONDS,
    ComfyWorkflowStalled,
    start_comfyui,
    submit_and_watch,
)


class Response:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps(self.value).encode("utf-8")


class ComfyStartupTests(unittest.TestCase):
    def test_websocket_allows_long_silent_sampling_steps(self):
        self.assertEqual(WEBSOCKET_TIMEOUT_SECONDS, 15)
        self.assertEqual(STALL_TIMEOUT_SECONDS, 5 * 60)

    @patch("minimax_h3.comfy.urllib.request.urlopen")
    def test_websocket_silence_is_a_heartbeat_not_a_job_failure(self, urlopen):
        class WebSocketTimeoutException(TimeoutError):
            pass

        socket = MagicMock()
        socket.recv.side_effect = [
            WebSocketTimeoutException(),
            json.dumps({"type": "execution_success", "data": {"prompt_id": "prompt-1"}}),
        ]
        websocket_module = types.SimpleNamespace(
            WebSocketTimeoutException=WebSocketTimeoutException,
            create_connection=MagicMock(return_value=socket),
        )
        urlopen.side_effect = [
            Response({"prompt_id": "prompt-1"}),
            Response({"queue_running": [], "queue_pending": [[1, "prompt-1"]]}),
            Response({"prompt-1": {"outputs": {"video": {"files": []}}}}),
        ]

        with patch.dict(sys.modules, {"websocket": websocket_module}):
            outputs = submit_and_watch({"node": {}})

        self.assertEqual(outputs, {"video": {"files": []}})
        self.assertEqual(socket.recv.call_count, 2)
        socket.close.assert_called_once_with()

    @patch("minimax_h3.comfy.time.monotonic")
    @patch("minimax_h3.comfy.urllib.request.urlopen")
    def test_running_prompt_without_progress_is_cancelled(self, urlopen, monotonic):
        class WebSocketTimeoutException(TimeoutError):
            pass

        socket = MagicMock()
        socket.recv.side_effect = WebSocketTimeoutException()
        websocket_module = types.SimpleNamespace(
            WebSocketTimeoutException=WebSocketTimeoutException,
            create_connection=MagicMock(return_value=socket),
        )
        monotonic.side_effect = [0, 0, STALL_TIMEOUT_SECONDS + 1]
        urlopen.side_effect = [
            Response({"prompt_id": "prompt-1"}),
            Response({"queue_running": [[1, "prompt-1"]], "queue_pending": []}),
            Response({"cancelled": True}),
        ]

        with patch.dict(sys.modules, {"websocket": websocket_module}):
            with self.assertRaises(ComfyWorkflowStalled):
                submit_and_watch({"node": {}})

        cancel_request = urlopen.call_args_list[-1].args[0]
        self.assertEqual(cancel_request.full_url, "http://127.0.0.1:8188/api/jobs/prompt-1/cancel")
        self.assertEqual(cancel_request.get_method(), "POST")
        socket.close.assert_called_once_with()

    @patch("minimax_h3.comfy.urllib.request.urlopen")
    def test_modal_cancellation_cancels_the_comfy_prompt(self, urlopen):
        class WebSocketTimeoutException(TimeoutError):
            pass

        socket = MagicMock()
        socket.recv.side_effect = KeyboardInterrupt()
        websocket_module = types.SimpleNamespace(
            WebSocketTimeoutException=WebSocketTimeoutException,
            create_connection=MagicMock(return_value=socket),
        )
        urlopen.side_effect = [
            Response({"prompt_id": "prompt-1"}),
            Response({"cancelled": True}),
        ]

        with patch.dict(sys.modules, {"websocket": websocket_module}):
            with self.assertRaises(KeyboardInterrupt):
                submit_and_watch({"node": {}})

        cancel_request = urlopen.call_args_list[-1].args[0]
        self.assertIn("/api/jobs/prompt-1/cancel", cancel_request.full_url)
        socket.close.assert_called_once_with()

    @patch("minimax_h3.comfy.subprocess.Popen")
    def test_starts_without_highvram_and_with_comfy_kitchen_attention(self, popen):
        start_comfyui(8199)

        command = popen.call_args.args[0]
        self.assertNotIn("--highvram", command)
        self.assertIn("--use-ck-attention", command)
        self.assertNotIn("--use-sage-attention", command)
        self.assertEqual(popen.call_args.kwargs["cwd"], COMFY_DIR)


if __name__ == "__main__":
    unittest.main()
