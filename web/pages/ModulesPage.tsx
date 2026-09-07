import { useEffect, useState } from "react";
import { AppWindow, School } from "lucide-react";
import { can, errorText, get, post } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Notice, Spinner } from "../components/ui";

type Row = Record<string, any>;
const words = (value: unknown) => String(value ?? "—").replaceAll("_", " ");

export function ModulesPage() {
  const { principal } = useAuth();
  const write = can(principal, "admin:write");
  const [modules, setModules] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try { setModules(await get<Row[]>("/modules")); }
    catch (error) { setMessage(errorText(error)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [principal?.organizationId]);

  async function toggle(module: Row) {
    setBusy(module.moduleKey);
    setMessage("");
    try {
      if (module.enabled) await post(`/modules/${module.moduleKey}/disable`, {});
      else await post(`/modules/${module.moduleKey}/enable`, { configuration: {} });
      setMessage(`${module.name} ${module.enabled ? "disabled" : "enabled"}.`);
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy("");
    }
  }

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Administration</span><h1>Apps & modules</h1><p>Enable optional Ledgerly capabilities per organization. Code modules are discovered from the repository's modules folder.</p></div></div>
    {message && <Notice tone={message.includes("enabled") || message.includes("disabled") ? "success" : "danger"}>{message}</Notice>}
    <div className="module-grid">
      {loading ? <Spinner/> : modules.map(module => { const requires=(module.manifest?.requiresModules||[]) as string[],missing=requires.filter((key:string)=>!modules.find(x=>x.moduleKey===key)?.enabled),dependents=modules.filter(x=>x.enabled&&((x.manifest?.requiresModules||[]) as string[]).includes(module.moduleKey)); return <Card key={module.moduleKey} className="module-card">
        <div className="module-card-icon">{module.moduleKey === "school-management" ? <School/> : <AppWindow/>}</div>
        <div><span className="row-actions"><h2>{module.name}</h2>{module.core && <Badge>Core</Badge>}</span><p>{module.description}</p><small>Version {module.version} · {words(module.category)}</small>{requires.length>0&&<small>Requires: {requires.map((key:string)=>modules.find(x=>x.moduleKey===key)?.name||key).join(", ")}</small>}{missing.length>0&&<small>Enable the required module first.</small>}{dependents.length>0&&<small>Used by: {dependents.map(x=>x.name).join(", ")}</small>}</div>
        <div className="module-card-action"><Badge tone={module.enabled ? "success" : "neutral"}>{module.enabled ? "active" : "inactive"}</Badge>{write && !module.core && <Button variant={module.enabled ? "secondary" : "primary"} disabled={busy === module.moduleKey||(!module.enabled&&missing.length>0)||(module.enabled&&dependents.length>0)} onClick={() => void toggle(module)}>{busy === module.moduleKey ? "Working…" : module.enabled ? "Disable" : "Enable"}</Button>}</div>
      </Card>})}
    </div>
  </div>;
}
