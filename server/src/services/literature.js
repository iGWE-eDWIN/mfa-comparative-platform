/**
 * Table 2.1 (Chapter 2 §2.7.2), reproduced verbatim. Contextual information from the literature
 * (Ometov et al., 2018; Mandujano & Lopez, 2023; Al-Sheeha et al., 2023; NIST SP 800-63B, 2017).
 * NOT measured by this platform (Chapter 3 §3.4.3; docs/DECISIONS.md D23).
 */
export const LITERATURE_TABLE_2_1 = {
  label: 'From literature (Table 2.1) — not measured',
  sources: 'Ometov et al. (2018); Mandujano & Lopez (2023); Al-Sheeha et al. (2023); NIST SP 800-63B (2017)',
  protocols: ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'],
  rows: [
    { criterion: 'Phishing Resistance', values: ['Low', 'Low', 'Low', 'High'] },
    { criterion: 'Replay Attack Resistance', values: ['Medium', 'Medium', 'Medium', 'High'] },
    { criterion: 'Desynchronisation Risk', values: ['High (Counter)', 'Low (Clock Drift)', 'None', 'None'] },
    { criterion: 'Implementation Complexity', values: ['Low', 'Low', 'Low', 'High'] },
    { criterion: 'Hardware Requirements', values: ['Optional', 'None', 'None', 'Optional / Required'] },
    { criterion: 'User Convenience', values: ['Medium', 'Medium', 'Medium', 'High'] },
    { criterion: 'Privacy Protection', values: ['Medium', 'Medium', 'Low', 'High'] },
    { criterion: 'Channel Dependency', values: ['None', 'None', 'SMTP / Email Provider', 'Platform API'] },
    { criterion: 'NIST AAL Level', values: ['AAL1', 'AAL2', 'AAL1', 'AAL2 / AAL3'] },
    { criterion: 'Technology Maturity', values: ['High', 'High', 'High', 'Medium–High'] },
  ],
};
