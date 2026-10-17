import { useState } from 'react';
import { parseCoaFile } from '../../../core/coa/parse.ts';
import { CoaPreview } from '../CoaPreview.tsx';
import { ErrorLine } from '../Icon.tsx';
import type { EditorDoc } from './doc.ts';

function parse(script: string) {
  try {
    return [...parseCoaFile(script).values()][0];
  } catch {
    return undefined;
  }
}

/** Paste a design copied from the in-game CoA designer and open it in the editor. */
export function ImportPanel({ onOpen }: { onOpen: (doc: EditorDoc) => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const coa = text.trim() ? parse(text) : undefined;

  return (
    <>
      <p className="small muted">In the game's coat of arms designer, use the copy button, then paste here.</p>
      <div className="import-row">
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="coa_rd_dynasty_…={ … }" />
        {coa ? <CoaPreview coa={coa} size={112} /> : <div className="hatch" style={{ width: 112, height: 112 }} />}
      </div>
      {text.trim() && !coa && <ErrorLine>This is not a valid coat of arms script.</ErrorLine>}
      <label className="field">
        <span className="label">Name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Moatstark" />
      </label>
      <div>
        <button
          className="primary small"
          disabled={!coa}
          onClick={() => {
            onOpen({ coa: coa!, name: name.trim() || 'Imported design' });
            setText('');
            setName('');
          }}
        >
          Open in editor
        </button>
      </div>
    </>
  );
}
