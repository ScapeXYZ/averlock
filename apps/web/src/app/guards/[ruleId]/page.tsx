import { TopNav } from "@/components/dashboard/top-nav";
import { GuardDetail } from "@/components/guards/guard-detail";

export default async function GuardPage({ params }: { params: Promise<{ ruleId: string }> }) { const { ruleId } = await params; return <div className="app-shell"><TopNav/><main className="guards-page detail-page"><GuardDetail ruleId={ruleId}/></main></div>; }
