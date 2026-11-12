import { getVehicles } from "../actions";
import { listAudit, listTickets } from "../tickets-actions";
import TicketManager from "@/components/TicketManager";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const session = await requireSession();
  const [tickets, vehicles, audit] = await Promise.all([
    listTickets(),
    getVehicles(),
    session.role === "admin" ? listAudit() : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Maintenance Tickets</h1>
      <p className="text-sm text-slate-600">
        Tickets live in MySQL; each ticket&rsquo;s description is also a vector in Qdrant. Edits re-embed the text and
        deletes remove the vector.
      </p>
      <TicketManager role={session.role} tickets={tickets} vehicles={vehicles} audit={audit} />
    </div>
  );
}
