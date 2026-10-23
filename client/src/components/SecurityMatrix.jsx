import { Outcome, ProtocolName } from './ui.jsx';

const TESTS = [
  ['phishingTest', 'Phishing (relay / origin binding)'],
  ['replayTest', 'Replay of a used code/assertion'],
  ['bruteForceTest', 'Brute force (rate limit / lockout)'],
  ['expiredCodeTest', 'Expired code / challenge'],
  ['desynchronisationObservation', 'Desynchronisation (counter / clock drift)'],
];

/** Security matrix (FR6): measured outcomes of controlled simulations, with explanations. */
export default function SecurityMatrix({ results }) {
  const withSec = results.filter((r) => r.securityOutcome?.phishingTest);
  if (!withSec.length)
    return <p className="muted">Security simulations were not run for this job.</p>;
  return (
    <div className="stack">
      <div className="table-wrap">
        <table>
          <caption>Controlled simulation outcomes (pass = the defence held)</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              {withSec.map((r) => (
                <th scope="col" key={r._id}>
                  <ProtocolName name={r.protocolName} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TESTS.map(([key, label]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {withSec.map((r) => (
                  <td key={r._id}>
                    <Outcome status={r.securityOutcome[key]?.status} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {withSec.map((r) => (
        <details key={r._id}>
          <summary>
            <ProtocolName name={r.protocolName} />: explanations and evidence
          </summary>
          <dl className="small" style={{ margin: '8px 0 0' }}>
            {TESTS.map(([key, label]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <dt>
                  <strong>{label}</strong> <Outcome status={r.securityOutcome[key]?.status} />
                </dt>
                <dd style={{ margin: '4px 0 0' }}>
                  {r.securityOutcome[key]?.explanation}
                  {r.securityOutcome[key]?.evidence &&
                    Object.keys(r.securityOutcome[key].evidence).length > 0 && (
                      <pre className="mono note" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                        {JSON.stringify(r.securityOutcome[key].evidence, null, 2)}
                      </pre>
                    )}
                </dd>
              </div>
            ))}
          </dl>
          {r.securityOutcome.securityNotes?.map((n) => (
            <p key={n} className="note">
              {n}
            </p>
          ))}
        </details>
      ))}
    </div>
  );
}
