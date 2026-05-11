# Persona Presets & Parameter Guidelines

## Built-in Presets

| Preset ID   | Name                    | ThinkTime | Factor | Bias | Profile                                |
|-------------|-------------------------|-----------|--------|------|----------------------------------------|
| `xiao_fang` | Expert Developer        | 1000ms    | 1.2    | 0.7  | Fast, impatient, high expectations     |
| `xiao_diu`  | Novice PM               | 2000ms    | 0.8    | 1.3  | Slow, patient, lower expectations      |

---

## Parameter Reference

### `humanThinkTimeMs` — Cognitive Processing Time

Time the persona spends thinking/deciding at each step.

| User Type           | Range           | Notes                                      |
|---------------------|-----------------|---------------------------------------------|
| Expert / Speed-run  | 500 – 1000 ms   | Knows the UI, minimal hesitation            |
| Average user        | 1500 ms         | Default; reads labels, considers options    |
| Novice / Cautious   | 2000 – 3000 ms  | Reads everything, uncertain about next step |

### `personaFactor` — Impatience Multiplier

Scales final pain score. Higher = more pain felt per unit of time.

| Temperament        | Range       | Notes                              |
|--------------------|-------------|------------------------------------|
| Impatient /急躁   | 1.2 – 1.5   | Easily frustrated by delays        |
| Normal             | 1.0         | Default                            |
| Patient / 耐心     | 0.6 – 0.9   | Tolerates waits, less pain felt    |

### `expectationBias` — Expectation Calibration

Scales the *expected* time baseline. Lower = higher bar, harder to impress.

| Expectation Level | Range       | Notes                                       |
|-------------------|-------------|----------------------------------------------|
| High / Expert     | 0.6 – 0.8   | Expects fast; anything slow feels unacceptable |
| Standard          | 1.0         | Default                                      |
| Relaxed / Lenient | 1.2 – 1.5   | Accepts slower flows; grade inflates upward  |

---

## Custom Persona Example

```typescript
resolvePersona({
  id: "senior_user",
  name: "Senior Non-tech User",
  humanThinkTimeMs: 2500,
  personaFactor: 0.7,
  expectationBias: 1.4,
  description: "Retired, first-time app user, patient but easily confused"
})
```

---

## Complexity → Expected Times

Used internally by `evaluateExperience()` to set baseline expectations per step.

| Complexity | Expected Time (ms) | Typical Use                          |
|------------|--------------------|--------------------------------------|
| `low`      | 1000               | Click, fill field, simple navigation |
| `medium`   | 3000               | Page load, search, form submit       |
| `high`     | 6000               | AI response, file upload, complex UI |
