"""
CSV -> JSON converter for the browser visualization.

Reads state_distributions_summary.csv (repo root) and writes
docs/data/states.json, shaped for direct fetch()-consumption by the
vanilla-JS site in docs/. Pure stdlib (csv, json) -- no pandas/scipy
dependency, so this can run without the heavier requirements.txt env.

Usage:
    python scripts/build_states_json.py
"""

import csv
import json
import os
import sys

USPS_TO_NAME = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
    'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
    'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
    'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
    'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
    'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
    'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
}

PINNED = ['CA', 'OH', 'WA']
DEFAULT_STATE = 'CA'
ROUND_DP = 6


def r(x):
    return round(float(x), ROUND_DP)


def convert(csv_path: str, json_path: str) -> None:
    states = {}
    with open(csv_path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            abbr = row['state'].strip()
            k = int(row['gmm_k'])
            if k == 1:
                # Uniform array shape (length gmm_k) so the browser never
                # branches on gmm_k -- always "loop over components".
                pi = [1.0]
                mu = [r(row['gmm_mu1'])]
                sigma = [r(row['gmm_sig1'])]
            elif k == 2:
                pi = [r(row['gmm_pi1']), r(row['gmm_pi2'])]
                mu = [r(row['gmm_mu1']), r(row['gmm_mu2'])]
                sigma = [r(row['gmm_sig1']), r(row['gmm_sig2'])]
            else:
                raise ValueError(f"Unsupported gmm_k={k} for state {abbr}")

            states[abbr] = {
                'name': USPS_TO_NAME.get(abbr, abbr),
                'n': int(row['n']),
                'median': r(row['median']),
                'mean': r(row['mean']),
                'std': r(row['std']),
                'frac_left': r(row['frac_left']),
                'frac_right': r(row['frac_right']),
                'polarization': r(row['polarization']),
                'gmm_k': k,
                'pi': pi,
                'mu': mu,
                'sigma': sigma,
            }

    missing_names = sorted(a for a in states if a not in USPS_TO_NAME)
    if missing_names:
        print(f"Warning: no full-name mapping for: {missing_names}", file=sys.stderr)

    payload = {
        'generated_from': os.path.basename(csv_path),
        'states': dict(sorted(states.items())),
        'pinned': PINNED,
        'default': DEFAULT_STATE,
    }

    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
        f.write('\n')

    print(f"Wrote {json_path} ({len(states)} states)")


if __name__ == '__main__':
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    csv_path = os.path.join(repo_root, 'state_distributions_summary.csv')
    json_path = os.path.join(repo_root, 'docs', 'data', 'states.json')

    if not os.path.exists(csv_path):
        print(f"CSV not found at '{csv_path}'. Run cces_state_distributions.py first.",
              file=sys.stderr)
        sys.exit(1)

    convert(csv_path, json_path)
