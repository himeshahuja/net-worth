import { site } from './site.js';

// The one strip of chrome: whose page this is on the left, its links on the right.
export default function Bar({ children }) {
  return (
    <header className="bar">
      <div className="bar-inner">
        <a className="owner" href={site.portfolio}>{site.owner}</a>
        <nav className="bar-links">{children}</nav>
      </div>
    </header>
  );
}
