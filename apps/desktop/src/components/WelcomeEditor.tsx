import { FileText } from "lucide-react";

export function WelcomeEditor() {
  return (
    <section className="welcome-editor">
      <FileText size={42} strokeWidth={1.2} />
      <h1>Document editor foundation</h1>
      <p>Djot + Document IRはPhase 4で、このResourceEditor slotへ接続する。</p>
      <code>ResourceEditor&lt;DocumentIR&gt;</code>
    </section>
  );
}
