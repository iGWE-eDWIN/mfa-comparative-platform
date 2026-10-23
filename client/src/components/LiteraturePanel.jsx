import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ProtocolName } from './ui.jsx';

/** Table 2.1 as contextual information: clearly labelled as literature, not measurement. */
export default function LiteraturePanel() {
  const [t, setT] = useState(null);
  useEffect(() => {
    api('/literature/table-2-1')
      .then(setT)
      .catch(() => {});
  }, []);
  if (!t) return null;
  return (
    <section className="card" aria-labelledby="lit-h">
      <h2 id="lit-h">{t.label}</h2>
      <p className="note">
        <strong>Not measured by this platform.</strong> Reproduced from Chapter 2, Table 2.1, as
        context for the measured results above. Sources: {t.sources}.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              {t.protocols.map((p) => (
                <th scope="col" key={p}>
                  <ProtocolName name={p} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.criterion}>
                <th scope="row">{r.criterion}</th>
                {r.values.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
