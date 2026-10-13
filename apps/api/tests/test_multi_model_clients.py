import unittest
from unittest.mock import Mock, patch

from stockdepth.workflows.trading_graph import StockDepthGraph


class MultiModelClientTests(unittest.TestCase):
    def build(self, quick, deep):
        graph = StockDepthGraph.__new__(StockDepthGraph)
        graph.config = {"model_configs": {"quick": quick, "deep": deep}}
        graph.callbacks = []
        return graph

    @patch("stockdepth.workflows.trading_graph.create_llm_client")
    def test_cross_provider_roles_keep_credentials_endpoints_and_options_separate(self, factory):
        factory.side_effect = [Mock(get_llm=Mock(return_value=Mock(with_config=Mock(return_value="quick-llm")))),
                               Mock(get_llm=Mock(return_value=Mock(with_config=Mock(return_value="deep-llm"))))]
        graph = self.build(
            {"id": 12, "provider": "qwen", "model": "qwen-fast", "base_url": "https://qwen.example/v1",
             "api_key": "quick-secret", "options": {"temperature": 0.2}, "prices": {"input": "1"}},
            {"id": 25, "provider": "openai", "model": "gpt-deep", "base_url": "https://openai.example/v1",
             "api_key": "deep-secret", "options": {"reasoning_effort": "high"}, "prices": {"input": "8"}},
        )

        quick = graph._make_role_llm("quick", graph.config["model_configs"]["quick"])
        deep = graph._make_role_llm("deep", graph.config["model_configs"]["deep"])

        self.assertEqual((quick, deep), ("quick-llm", "deep-llm"))
        self.assertEqual(factory.call_args_list[0].kwargs["provider"], "qwen")
        self.assertEqual(factory.call_args_list[0].kwargs["api_key"], "quick-secret")
        self.assertEqual(factory.call_args_list[0].kwargs["base_url"], "https://qwen.example/v1")
        self.assertEqual(factory.call_args_list[0].kwargs["temperature"], 0.2)
        self.assertEqual(factory.call_args_list[1].kwargs["provider"], "openai")
        self.assertEqual(factory.call_args_list[1].kwargs["api_key"], "deep-secret")
        self.assertEqual(factory.call_args_list[1].kwargs["reasoning_effort"], "high")
        self.assertNotIn("quick-secret", repr(factory.call_args_list[1]))

    @patch("stockdepth.workflows.trading_graph.create_llm_client")
    def test_same_provider_and_same_model_still_use_distinct_config_keys(self, factory):
        factory.side_effect = [Mock(get_llm=Mock(return_value=Mock(with_config=Mock(return_value="quick")))),
                               Mock(get_llm=Mock(return_value=Mock(with_config=Mock(return_value="deep"))))]
        same_name = {"provider": "openai-compatible", "model": "gpt-5", "base_url": "https://gateway.example/v1"}
        graph = self.build({**same_name, "id": 1, "api_key": "account-a", "options": {}},
                           {**same_name, "id": 2, "api_key": "account-b", "options": {}})
        graph._make_role_llm("quick", graph.config["model_configs"]["quick"])
        graph._make_role_llm("deep", graph.config["model_configs"]["deep"])
        self.assertEqual([call.kwargs["api_key"] for call in factory.call_args_list], ["account-a", "account-b"])


if __name__ == "__main__":
    unittest.main()
