import json
import sys
from pathlib import Path

import pandas as pd

def main(xlsx_path: str, out_json: str):
    xlsx = Path(xlsx_path)
    if not xlsx.exists():
        raise FileNotFoundError(xlsx_path)

    # Lê a primeira aba por padrão
    df = pd.read_excel(xlsx_path)

    # Normaliza nomes de colunas comuns do Qualis (ISSN, Título, Estrato)
    # Ajuste aqui se sua planilha vier com nomes diferentes.
    rename_map = {}
    for col in df.columns:
        c = str(col).strip().lower()
        if c in ["issn", "issn "]:
            rename_map[col] = "ISSN"
        elif c in ["título", "titulo", "title"]:
            rename_map[col] = "Título"
        elif c in ["estrato", "classificação", "classificacao", "qualis"]:
            rename_map[col] = "Estrato"

    df = df.rename(columns=rename_map)

    # Mantém só as colunas que a sua app usa hoje
    keep = [c for c in ["ISSN", "Título", "Estrato"] if c in df.columns]
    df = df[keep].dropna(how="all")

    # Remove linhas sem título
    if "Título" in df.columns:
        df = df[df["Título"].astype(str).str.strip().ne("")]

// Converte para lista de dict
    records = df.fillna("").to_dict(orient="records")

    Path(out_json).parent.mkdir(parents=True, exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"OK: {len(records)} registros -> {out_json}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python scripts/xlsx_to_json.py arquivo.xlsx public/qualis/2021-2024/engenharias-iv.json")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
