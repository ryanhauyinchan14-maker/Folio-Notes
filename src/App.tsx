import React, { useEffect } from 'react';
import { NotebookEditor } from './components/editor/NotebookEditor';
import { PdfImportProgressModal } from './components/modals/PdfImportProgressModal';
import { HomeShelf } from './components/shelf/HomeShelf';
import { useAppStore } from './store/useAppStore';

export const App: React.FC = () => {
  const initApp = useAppStore((s) => s.initApp);
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const highContrastUi = useAppStore((s) => s.highContrastUi);

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => {
    document.documentElement.dataset.contrast = highContrastUi ? 'high' : 'default';
  }, [highContrastUi]);

  return (
    <>
      {activeNotebook ? <NotebookEditor /> : <HomeShelf />}
      <PdfImportProgressModal />
    </>
  );
};

export default App;
