"""Обёртка над OpenAI Responses API.

Основной режим — structured outputs (json_schema, strict). Если модель не принимает strict-схему,
клиент один раз переключается на JSON без схемы; разбор и проверку в любом случае делает код (Pydantic).
Если модель не принимает temperature, параметр отключается. Тексты запросов не логируются.
"""

import json
import logging

from pydantic import BaseModel, ValidationError

from . import config

log = logging.getLogger("aqylroute.llm")


class LLMError(Exception):
    pass


class LLM:
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        from openai import OpenAI

        self.model = model
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=config.OPENAI_TIMEOUT_S, max_retries=1)
        self.use_strict_schema = True
        self.use_temperature = True

    def _call(self, name: str, schema: dict, instructions: str, user_input: str):
        kwargs: dict = {"model": self.model, "input": user_input, "store": False}
        if self.use_strict_schema:
            kwargs["instructions"] = instructions
            kwargs["text"] = {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}}
        else:
            kwargs["instructions"] = (
                instructions
                + "\n\nОтветь ТОЛЬКО JSON-объектом без пояснений, строго по этой JSON Schema:\n"
                + json.dumps(schema, ensure_ascii=False)
            )
            kwargs["text"] = {"format": {"type": "json_object"}}
        if self.use_temperature:
            kwargs["temperature"] = config.OPENAI_TEMPERATURE
        return self.client.responses.create(**kwargs)

    def structured(self, name: str, schema: dict, instructions: str, user_input: str,
                   model_cls: type[BaseModel] | None = None) -> dict:
        from openai import BadRequestError

        resp = None
        for _ in range(3):  # до двух адаптаций параметров под модель
            try:
                resp = self._call(name, schema, instructions, user_input)
                break
            except BadRequestError as e:
                msg = str(e).lower()
                if self.use_temperature and "temperature" in msg:
                    log.warning("model rejected temperature, disabling it")
                    self.use_temperature = False
                    continue
                if self.use_strict_schema and any(k in msg for k in ("json_schema", "strict", "text.format", "response_format")):
                    log.warning("model rejected strict json_schema, falling back to json_object + validation")
                    self.use_strict_schema = False
                    continue
                raise LLMError(f"OpenAI bad request: {type(e).__name__}") from e
            except Exception as e:  # сеть, лимиты, неверный ключ и т.п.
                raise LLMError(f"OpenAI request failed: {type(e).__name__}") from e
        if resp is None:
            raise LLMError("OpenAI request failed after parameter fallbacks")

        text = resp.output_text or ""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError("Model returned invalid JSON") from e
        if not isinstance(data, dict):
            raise LLMError("Model returned non-object JSON")
        if model_cls is not None:
            try:
                data = model_cls.model_validate(data).model_dump()
            except ValidationError as e:
                raise LLMError(f"Model JSON failed validation: {e.error_count()} errors") from e
        return data


_llm = None


def get_llm():
    """None означает демо-режим без ключа: вопросы и план строятся детерминированно."""
    global _llm
    if _llm is None and config.OPENAI_API_KEY:
        _llm = LLM(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.OPENAI_BASE_URL)
    return _llm


def set_llm(llm) -> None:
    """Для тестов: подменить клиента."""
    global _llm
    _llm = llm


def mode() -> str:
    return "openai" if (_llm is not None or config.OPENAI_API_KEY) else "mock"
