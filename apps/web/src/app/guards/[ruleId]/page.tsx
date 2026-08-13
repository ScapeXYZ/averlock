import { GuardDetailPage } from "@/components/base/base-pages";

export default async function GuardPage({ params }: { params: Promise<{ ruleId: string }> }) { const { ruleId } = await params; return <GuardDetailPage guardId={ruleId}/>; }
