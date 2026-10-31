import { useEffect, useRef, useState } from 'react';

// The width of a chart's box, kept current as the page resizes, plus one more render once the fonts have
// arrived, because the chart measures its labels in the page's own face.
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [, setFontsLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    document.fonts?.ready.then(() => live && setFontsLoaded(true));
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}
