import { CreateGuardFlow } from "@/components/guards/create-guard-flow";
import { TopNav } from "@/components/dashboard/top-nav";

export default function NewGuardPage() { return <div className="app-shell"><TopNav/><main className="guard-page"><CreateGuardFlow/></main></div>; }
