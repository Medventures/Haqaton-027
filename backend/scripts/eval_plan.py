"""Проверка на реальной модели: N генераций плана для одного кейса.

Набор шагов задаёт код (rules.py); проверяем, что модель возвращает валидный JSON ровно с этим набором,
без стоп-слов, и сколько раз понадобился fallback.

Запуск:  python -m scripts.eval_plan --scenario 2 --runs 10
"""

import argparse
import os
import sys
import tempfile
import time
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "eval.db"))

from app import config, db  # noqa: E402
from app.catalog import QUESTIONS_BY_ID, SCENARIOS  # noqa: E402
from app.llm import LLMError, get_llm  # noqa: E402
from app.plan import PLAN_INSTRUCTIONS, _llm_input, generate, plan_schema, validate_llm  # noqa: E402
from app.rules import Profile, evaluate_all  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="2", choices=list(SCENARIOS))
    ap.add_argument("--runs", type=int, default=10)
    args = ap.parse_args()

    llm = get_llm()
    if llm is None:
        print("OPENAI_API_KEY не задан — оценка реальной модели невозможна.")
        return 2

    db.init_db()
    with db.tx() as conn:
        services = db.load_services(conn)
    sc = SCENARIOS[args.scenario]
    slots = {QUESTIONS_BY_ID[q]["slot"]: a for q, a in sc["answers"].items()}
    case = {"birth_date": sc["birth_date"], "city": sc["city"], "intake": sc["intake"], "profile": slots}
    p = Profile(case, set(sc["intake"]["documents"]), date.fromisoformat(config.DEMO_SEED_TODAY))
    expected = evaluate_all(p)
    schema = plan_schema(list(expected))
    user_input = _llm_input(expected, services, p)

    raw_ok = raw_set_ok = sources = 0
    counts: dict[str, int] = {}
    print(f"Модель: {config.OPENAI_MODEL}, кейс {args.scenario}, шаги кода: {list(expected)}, запусков: {args.runs}\n")
    for i in range(1, args.runs + 1):
        t0 = time.time()
        try:
            data = llm.structured("case_plan", schema, PLAN_INSTRUCTIONS, user_input)
            raw_ok += 1
            _, warnings, errors = validate_llm(data, expected, services)
            raw_set_ok += int(not errors)
            raw = f"набор={'ok' if not errors else 'НЕ совпал'} предупреждений={len(warnings)}"
        except LLMError as e:
            raw = f"ОШИБКА: {e}"
        _, texts, meta = generate(p, services)
        counts[meta["source"]] = counts.get(meta["source"], 0) + 1
        sources += int(set(texts) == set(expected))
        print(f"#{i:02d} {time.time() - t0:5.1f}s  сырой: {raw};  итог: {meta['source']}")

    print("\n=== Итог ===")
    print(f"Валидный JSON (сырой): {raw_ok}/{args.runs}")
    print(f"Набор шагов совпал с кодом (сырой): {raw_set_ok}/{args.runs}")
    print(f"Итоговый набор совпал с кодом: {sources}/{args.runs}")
    print(f"Источник текстов: {counts}")
    return 0 if raw_ok == raw_set_ok == sources == args.runs else 1


if __name__ == "__main__":
    sys.exit(main())
