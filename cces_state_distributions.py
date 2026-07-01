"""
CCES 2020 → State-Level Partisan Distributions for Spatial Modeling
=====================================================================
Replicates Atkinson-Foley-Ganz (2024) state-level voter distributions
and optionally fits Gaussian mixture models (more useful for spatial models).

Prerequisites:
    pip install pandas pyreadstat scipy scikit-learn matplotlib

Data:
    Download 'CCES20_Common_OUTPUT_vv_topost.dta' from:
    https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/E9N6PH
    (free registration required)
"""

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import minimize
import warnings
warnings.filterwarnings('ignore')

# ── FIPS → state abbreviation lookup ────────────────────────────────────────
FIPS_TO_STATE = {
    1:'AL', 2:'AK', 4:'AZ', 5:'AR', 6:'CA', 8:'CO', 9:'CT', 10:'DE',
    11:'DC', 12:'FL', 13:'GA', 15:'HI', 16:'ID', 17:'IL', 18:'IN',
    19:'IA', 20:'KS', 21:'KY', 22:'LA', 23:'ME', 24:'MD', 25:'MA',
    26:'MI', 27:'MN', 28:'MS', 29:'MO', 30:'MT', 31:'NE', 32:'NV',
    33:'NH', 34:'NJ', 35:'NM', 36:'NY', 37:'NC', 38:'ND', 39:'OH',
    40:'OK', 41:'OR', 42:'PA', 44:'RI', 45:'SC', 46:'SD', 47:'TN',
    48:'TX', 49:'UT', 50:'VT', 51:'VA', 53:'WA', 54:'WV', 55:'WI',
    56:'WY',
}

# ── Atkinson et al. bin mapping ──────────────────────────────────────────────
# pid7: 1=Strong Dem, 2=Not strong Dem, 3=Lean Dem, 4=Independent,
#       5=Lean Rep, 6=Not strong Rep, 7=Strong Rep, 8=Not sure (exclude)
#
# Mapped to 5 groups → uniform draws on intervals of width 0.2 in [-0.5, 0.5]
PID7_TO_INTERVAL = {
    1: (-0.5, -0.3),   # Strong Democrat
    2: (-0.3, -0.1),   # Not strong Democrat
    3: (-0.3, -0.1),   # Lean Democrat  (Atkinson collapses 2 & 3)
    4: (-0.1,  0.1),   # Independent / No party
    5: ( 0.1,  0.3),   # Lean Republican
    6: ( 0.1,  0.3),   # Not strong Republican (collapsed with 5)
    7: ( 0.3,  0.5),   # Strong Republican
    # 8 = Not sure → excluded
}


def load_cces(filepath: str) -> pd.DataFrame:
    """Load CCES .dta file and return relevant columns."""
    cols = ['inputstate', 'pid7', 'commonweight']   # add more as needed
    # convert_categoricals=False: keep numeric codes (e.g. pid7=1, inputstate=6)
    # instead of pandas' default of substituting Stata value labels, which
    # would turn these into strings like "Strong Democrat" / "California".
    df = pd.read_stata(filepath, columns=cols, convert_categoricals=False)
    df = df.rename(columns={'inputstate': 'fips', 'commonweight': 'weight'})
    df['state'] = df['fips'].map(FIPS_TO_STATE)
    # Drop territories and "not sure" pid
    df = df[df['pid7'].between(1, 7) & df['state'].notna()].copy()
    df['pid7'] = df['pid7'].astype(int)
    return df


def atkinson_scores(df: pd.DataFrame, n_draws: int = 500,
                    rng: np.random.Generator = None) -> dict[str, np.ndarray]:
    """
    Replicate Atkinson et al. method:
    Draw n_draws ideal points per respondent uniformly from their pid7 bin,
    weighted by commonweight.

    Returns dict: state abbreviation → 1-D array of ideal point scores.
    """
    if rng is None:
        rng = np.random.default_rng(42)

    state_scores = {}
    for state, grp in df.groupby('state'):
        scores = []
        weights = grp['weight'].values
        weights = weights / weights.sum()          # normalise
        for _, row in grp.iterrows():
            lo, hi = PID7_TO_INTERVAL[int(row['pid7'])]
            scores.append(rng.uniform(lo, hi))
        state_scores[state] = np.array(scores)

    return state_scores


def fit_gmm(scores: np.ndarray, n_components: int = 2) -> dict:
    """
    Fit a k-component Gaussian mixture to a state's ideal point distribution.
    Returns dict with keys: weights, means, stds, bic.

    This is more useful than Atkinson's empirical distribution for spatial
    models because it gives you closed-form parameters (π, μ_k, σ_k).
    """
    from sklearn.mixture import GaussianMixture
    X = scores.reshape(-1, 1)
    best = None
    best_bic = np.inf
    for k in range(1, n_components + 1):
        gm = GaussianMixture(n_components=k, n_init=10, random_state=42)
        gm.fit(X)
        bic = gm.bic(X)
        if bic < best_bic:
            best_bic = bic
            best = gm
    order = np.argsort(best.means_.ravel())
    return {
        'n_components': best.n_components,
        'weights':      best.weights_[order],
        'means':        best.means_.ravel()[order],
        'stds':         np.sqrt(best.covariances_.ravel()[order]),
        'bic':          best_bic,
    }


def state_summary_table(state_scores: dict[str, np.ndarray],
                        fit_gmm_params: bool = True) -> pd.DataFrame:
    """
    Build a summary DataFrame with per-state statistics:
      - median, mean, std of ideal point distribution
      - fraction left-leaning (score < 0), fraction right-leaning (score > 0)
      - GMM parameters (if requested): π, μ_L, σ_L, μ_R, σ_R
    """
    rows = []
    for state, scores in sorted(state_scores.items()):
        row = {
            'state':        state,
            'n':            len(scores),
            'median':       np.median(scores),
            'mean':         np.mean(scores),
            'std':          np.std(scores),
            'frac_left':    np.mean(scores < 0),
            'frac_right':   np.mean(scores > 0),
            'polarization': np.mean(np.abs(scores)),   # mean absolute deviation from 0
        }
        if fit_gmm_params:
            gmm = fit_gmm(scores, n_components=2)
            row.update({
                'gmm_k':    gmm['n_components'],
                'gmm_pi1':  gmm['weights'][0],
                'gmm_mu1':  gmm['means'][0],
                'gmm_sig1': gmm['stds'][0],
                'gmm_pi2':  gmm['weights'][1] if gmm['n_components'] > 1 else np.nan,
                'gmm_mu2':  gmm['means'][1]   if gmm['n_components'] > 1 else np.nan,
                'gmm_sig2': gmm['stds'][1]    if gmm['n_components'] > 1 else np.nan,
            })
        rows.append(row)
    return pd.DataFrame(rows).set_index('state')


def sample_from_state(state: str,
                      summary: pd.DataFrame,
                      n: int,
                      rng: np.random.Generator = None) -> np.ndarray:
    """
    Draw n ideal points for `state` from the fitted GMM parameters.
    Useful for Monte Carlo simulation of open primaries without reloading raw data.
    """
    if rng is None:
        rng = np.random.default_rng(42)
    row = summary.loc[state]
    k = int(row['gmm_k'])
    if k == 1:
        return rng.normal(row['gmm_mu1'], row['gmm_sig1'], size=n)
    # k == 2
    component = rng.choice([0, 1], size=n, p=[row['gmm_pi1'], row['gmm_pi2']])
    means = np.array([row['gmm_mu1'], row['gmm_mu2']])
    stds  = np.array([row['gmm_sig1'], row['gmm_sig2']])
    return rng.normal(means[component], stds[component])


# ── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import sys, os

    # ── 1. Load data ──────────────────────────────────────────────────────────
    cces_path = 'data\\CES20_Common_OUTPUT_vv.dta'   # adjust path as needed
    if not os.path.exists(cces_path):
        print(f"CCES file not found at '{cces_path}'.")
        print("Download from: https://dataverse.harvard.edu/dataset.xhtml"
              "?persistentId=doi:10.7910/DVN/E9N6PH")
        sys.exit(1)

    print("Loading CCES data...")
    df = load_cces(cces_path)
    print(f"  {len(df):,} respondents across {df['state'].nunique()} states/DC")

    # ── 2. Build Atkinson-style empirical distributions ───────────────────────
    print("Building state ideal point distributions...")
    state_scores = atkinson_scores(df)

    # ── 3. Fit GMMs and build summary table ───────────────────────────────────
    print("Fitting Gaussian mixture models per state (this takes ~30s)...")
    summary = state_summary_table(state_scores, fit_gmm_params=True)
    summary.to_csv('state_distributions_summary.csv')
    print("Summary saved to 'state_distributions_summary.csv'")
    print()
    print(summary[['median', 'mean', 'std', 'frac_left', 'frac_right',
                   'polarization']].round(3).to_string())

    # ── 4. Example: sample voters for California open primary simulation ──────
    print()
    print("Example: sampling 10,000 voters for CA open primary simulation...")
    ca_voters = sample_from_state('CA', summary, n=10_000)
    print(f"  CA median: {np.median(ca_voters):.3f}, "
          f"mean: {np.mean(ca_voters):.3f}, "
          f"std: {np.std(ca_voters):.3f}")
