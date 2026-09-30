"""Критерий готовности: N запусков генерации плана для одного кейса на реальной модели.

Считает сырой ответ модели (до фильтров кода): валидный JSON, шаги вне справочника,
стоп-слова, а также итог после валидации (источник: llm / llm_retry / fallback).

Запуск:  OPENAI_API_KEY=... python -m scripts.eval_plan --scenario A --runs 10
"""

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "eval.db"))

from app import config, db  # noqa: E402
from app.catalog import SCENARIOS  # noqa: E402
from app.interview import age_months, autofill  # noqa: E402
from app.llm import LLMError, get_llm  # noqa: E402
from app.plan import PLAN_INSTRUCTIONS, _plan_input, generate_steps, plan_schema, validate_plan  # noqa: E402
from app.safety import find_stop_words  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="A", choices=list(SCENARIOS))
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
    case = {"birth_date": sc["birth_date"], "city": sc["city"]}
    today = date.today()
    months = age_months(sc["birth_date"], today)
    interview = {"items": autofill([], case, args.scenario, today), "done": True}
    schema = plan_schema(list(services))
    user_input = _plan_input(interview, services, months, sc["city"])

    raw_ok = out_of_catalog = unsafe = 0
    final_sources: dict[str, int] = {}
    final_out_of_catalog = 0
    print(f"Модель: {config.OPENAI_MODEL}, сценарий {args.scenario}, запусков: {args.runs}\n")
    for i in range(1, args.runs + 1):
        t0 = time.time()
        # 1) сырой ответ модели
        try:
            data = llm.structured("case_plan", schema, PLAN_INSTRUCTIONS, user_input)
            steps, warnings, errors = validate_plan(data, services, months)
            raw_ok += int(isinstance(data.get("steps"), list))
            bad_ids = [s.get("service_id") for s in data.get("steps", []) if s.get("service_id") not in services]
            out_of_catalog += len(bad_ids)
            unsafe += sum(1 for s in data.get("steps", []) if find_stop_words(s.get("explanation", "")))
            raw_desc = f"steps={len(data.get('steps', []))} вне_справочника={len(bad_ids)} ошибки={len(errors)}"
        except LLMError as e:
            raw_desc = f"ОШИБКА: {e}"
        # 2) полный конвейер (с повтором и запасным планом)
        final, meta = generate_steps(interview, services, months, sc["city"], sc["language"])
        final_sources[meta["source"]] = final_sources.get(meta["source"], 0) + 1
        final_out_of_catalog += sum(1 for s in final if s["service_id"] not in services)
        print(f"#{i:02d} {time.time() - t0:5.1f}s  сырой: {raw_desc};  итог: {meta['source']}, шагов {len(final)}")

    print("\n=== Итог ===")
    print(f"Валидный JSON по схеме (сырой): {raw_ok}/{args.runs} ({100 * raw_ok // args.runs}%)")
    print(f"Шагов вне справочника (сырой): {out_of_catalog}")
    print(f"Объяснений со стоп-словами (сырой): {unsafe}")
    print(f"Шагов вне справочника в итоговом плане: {final_out_of_catalog}")
    print(f"Источник итогового плана: {json.dumps(final_sources, ensure_ascii=False)}")
    return 0 if raw_ok == args.runs and out_of_catalog == 0 and final_out_of_catalog == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
