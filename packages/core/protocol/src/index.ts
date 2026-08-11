export type ResourceType = "spreadsheet" | "document" | "asset";

export interface WorkspaceResource {
  id: string;
  name: string;
  type: ResourceType;
  path: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  rootPath: string;
  resources: WorkspaceResource[];
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface EditorContext {
  resourceId: string;
  resourceType: ResourceType;
  activeView: "visual" | "source" | "diff" | "history" | "problems" | "terminal" | "activity" | "git";
  selection?: string[];
  activeCell?: string | null;
}
