# Score points

The **Score** column on `/results` ranks candidates by the recommendations their panelists gave. Click its
header once to put the highest score on top (`/results?sort=score&dir=desc`).

The score only helps admins read the votes. It doesn't decide anything: admins still mark each candidate
Selected or Not selected themselves, and team preferences and team-fit scores still matter.

## Points per recommendation

Every evaluation has one required recommendation. Each one is worth some points:

| Recommendation | Points |
| --- | --- |
| Strong Yes | 4 |
| Yes | 3 |
| Maybe | 1 |
| No | 0 |

The gap between Yes and Maybe is the biggest on purpose. That's where "take them" turns into "don't".

## The formula

Every candidate gets **one imaginary vote** added to their real votes, worth the induction's average. Then
the normal average is taken:

$$
\text{Adjusted Score} = \frac{P + A}{N + 1}
$$

Don't worry about the letters. Each one represents something simple.

| Symbol | Meaning |
| --- | --- |
| $P$ | Total points from the candidate's actual recommendations |
| $A$ | Average points per recommendation across the entire induction |
| $N$ | Number of actual recommendations the candidate received |
| $1$ | The one imaginary vote we add |

In plain text: `score = (P + A) / (N + 1)`.

## How A is worked out

$A$ is every recommendation in the induction added up as points, divided by how many recommendations there
are. It's the same number for every candidate, and it moves a little as evaluations come in.

For example, if the whole induction so far has 10 recommendations, 4 Strong Yes, 2 Yes, 3 Maybe and 1 No:

```
points = 4×4 + 2×3 + 3×1 + 1×0 = 16 + 6 + 3 + 0 = 25
A      = 25 points ÷ 10 recommendations = 2.5
```

The note above the Results table shows the real $A$ for your induction.

## A worked example

With $A = 2.5$:

**Ali got 1 Strong Yes.** $P = 4$, $N = 1$.

$$
\frac{4 + 2.5}{1 + 1} = \frac{6.5}{2} = 3.25
$$

**Sara got 4 Strong Yes.** $P = 16$, $N = 4$.

$$
\frac{16 + 2.5}{4 + 1} = \frac{18.5}{5} = 3.7
$$

A plain average would make them tied at 4. The imaginary vote is half of Ali's votes, so it pulls his score
down a lot. It's one of Sara's five, so it barely moves hers. **Sara ranks above Ali.**

That's fair because Ali was rated by just one person, which might be luck or a generous panelist. Four
people all saying Strong Yes is much stronger proof. **The more people agree, the more the score is
trusted.**

## Why not a simpler rule

- **A total rewards bigger panels.** 4 Yes (12 points) would beat 2 Strong Yes (8 points) only because two
  more panelists voted. Candidates don't choose their panel.
- **A plain average trusts single votes too much.** One Strong Yes would average 4.0, the same as four
  Strong Yes.
- **Counting only Strong Yes ignores Maybe and No.** 1 Strong Yes + 3 No would rank above 4 Yes.

## More examples

With $A = 2.5$:

| Recommendations | P | N | Score | What it shows |
| --- | --- | --- | --- | --- |
| 4 Strong Yes | 16 | 4 | 3.7 | |
| 3 Strong Yes | 12 | 3 | 3.63 | |
| 2 Strong Yes | 8 | 2 | 3.5 | A unanimous pair beats a single vote |
| 1 Strong Yes | 4 | 1 | 3.25 | One person's opinion is trusted less |
| 3 Strong Yes + 1 Maybe | 13 | 4 | 3.1 | A split panel drops below a unanimous one |
| 4 Yes | 12 | 4 | 2.9 | Four Yes stay below three Strong Yes |
| 2 Yes | 6 | 2 | 2.83 | |
| 3 Strong Yes + 2 No | 12 | 5 | 2.42 | No counts against, without being a veto |
| 1 No | 0 | 1 | 1.25 | One harsh vote can't push someone to the bottom alone |

Panel size matters only a little: 2 Strong Yes (3.5) and 4 Strong Yes (3.7) are just 0.2 apart, and both
beat 3 Strong Yes + 1 Maybe (3.1). Whether the panel agreed matters much more than how many people were on
it.

## The details

- **Rounding:** scores are rounded to 2 decimals, so candidates who look tied are tied.
- **Ties:** equal scores go by General avg (the panelists' 1–5 criteria scores), then by candidate number.
- **No recommendations yet:** the score shows "—" and the candidate always goes last, whichever way you sort.
- **Filters don't change scores.** $A$ always comes from the whole induction, so filtering to one batch or
  to Undecided candidates gives everyone the same score as in the full table.
- **Which votes count:** every evaluation on the candidate's interviews. Cancelled send-ins are left out.
- **Nothing is saved.** The score is worked out in the browser each time `/results` opens, from the
  recommendation counts the page already loads. It isn't in the CSV exports.

This is the same idea IMDb uses to rank its Top 250 films. The code is `RECOMMENDATION_POINTS`,
`averageVotePoints` and `candidateScore` in `src/results/resultsView.ts`.

## What it doesn't correct for

If one panel gives Strong Yes easily and another rarely does, candidates sent to the strict panel lose out.
The score doesn't adjust for that. If it looks like a problem, compare each panel's average points before
deciding to add a correction.
