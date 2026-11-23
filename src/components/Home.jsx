import { useState } from 'react';
import { Plus, FolderUp, BookOpen, Loader2 } from 'lucide-react';
import Workspace from './Workspace.jsx';
import AddDialog from './AddDialog.jsx';
import FolderImport from './FolderImport.jsx';
import { go } from '../lib/nav.js';

// Home.jsx — shown only while loading or when there are no lessons yet;
// otherwise the app opens straight into a lesson.
export default function Home(props) {
  const { catalog, reload, loadError } = props;
  const [adding, setAdding] = useState(null);       // null | { kind }
  const [folderOpen, setFolderOpen] = useState(false);

  return (
    <>
      <Workspace {...props} active={{ type: 'home' }} title={catalog ? 'Hələ dərs yoxdur' : 'Yüklənir'}>
        {!catalog && !loadError && <div className="empty-state"><Loader2 size={18} className="spin" />Dərslər yüklənir</div>}
        {!catalog && loadError && (
          <div className="empty-state error">
            {loadError}
            <button className="btn small" onClick={reload}>Yenidən yoxla</button>
          </div>
        )}
        {catalog && (
          <div className="missing"><div className="ga-card ga-empty">
            <BookOpen size={26} />
            <strong>Hələ dərs yoxdur</strong>
            <span>Normativ aktı, izahlı materialı və Word test bankını seçərək ilk dərsi yaradın, və ya DERSLER qovluğunu bir dəfəyə yükləyin. Əlavə etdiyiniz hər şey bütün işçilər üçün görünür.</span>
            <div className="home-acts">
              <button className="btn" onClick={() => setFolderOpen(true)}><FolderUp size={16} />Qovluqdan yüklə</button>
              <button className="btn primary" onClick={() => setAdding({ kind: 'lesson' })}><Plus size={16} />Dərs əlavə et</button>
            </div>
          </div></div>
        )}
      </Workspace>

      {adding && <AddDialog kind={adding.kind} catalog={catalog} onClose={() => setAdding(null)}
        onDone={async (res) => { setAdding(null); await reload(); if (res?.go) go(res.go); }} />}
      {folderOpen && <FolderImport catalog={catalog} onClose={() => setFolderOpen(false)} onDone={async () => { await reload(); }} />}
    </>
  );
}
