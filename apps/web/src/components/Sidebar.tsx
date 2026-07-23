const mainItems = [
  ['Dashboard','⌂','/'],['Campaigns','◉','/campaigns'],['Content History','▤','/content-history'],
  ['Calendar','□','#'],['AI Studio','✦','/ai-studio'],['Brand Copilot','◎','/copilot'],['Analytics','⌁','#'],
];
const resourceItems = [['Asset Library','◇','/assets'],['Prompt Library','≡','#'],['Brand Brain','◆','/brand-brain'],['Settings','⚙','#']];

export function Sidebar() {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">A</div><div><div className="brand-title">Atlas</div><div className="brand-subtitle">AI Marketing Suite</div></div></div>
    <div className="nav-section-label">Workspace</div>
    <nav className="nav-list">{mainItems.map(([label,icon,href])=><a className="nav-item" href={href} key={label}><span className="nav-icon">{icon}</span><span>{label}</span></a>)}</nav>
    <div className="nav-section-label">Resources</div>
    <nav className="nav-list">{resourceItems.map(([label,icon,href])=><a className="nav-item" href={href} key={label}><span className="nav-icon">{icon}</span><span>{label}</span></a>)}</nav>
    <div className="sidebar-bottom"><div className="workspace-card"><div className="workspace-label">Current workspace</div><div className="workspace-name">MGMBETMYR</div><div className="workspace-meta">Enterprise plan</div></div></div>
  </aside>;
}
