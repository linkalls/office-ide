import { AgentPane } from "./components/AgentPane";
import { CommandPalette } from "./components/CommandPalette";
import { Explorer } from "./components/Explorer";
import { MainEditor } from "./components/MainEditor";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { useOfficeWorkspace } from "./state/useOfficeWorkspace";

export function App() {
  const workspace = useOfficeWorkspace();

  return (
    <div className="app-shell">
      <TitleBar workspace={workspace} />
      <div
        className="workspace-shell"
        data-agent-open={workspace.agentOpen}
        data-explorer-open={workspace.explorerOpen}
      >
        {workspace.explorerOpen ? <Explorer workspace={workspace} /> : null}
        <MainEditor workspace={workspace} />
        {workspace.agentOpen ? <AgentPane workspace={workspace} /> : null}
      </div>
      <StatusBar workspace={workspace} />
      {workspace.paletteOpen ? <CommandPalette workspace={workspace} /> : null}
    </div>
  );
}
