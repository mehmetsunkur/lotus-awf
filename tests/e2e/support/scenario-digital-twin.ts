import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import {
  AIRLINE_STAFF_GROUPS,
  airlinePersonaContext,
  seedAgenticAirlines,
  type AirlinePersonaName,
  type AirlineScenario,
  type SeedAirlineOptions
} from "./scenario-agentic-airlines";

/**
 * Digital-twin extension of the Agentic Airlines fixture (M27): job descriptions on the
 * org chart, a knowledge-base app whose procedures are AUTHORED by a department member
 * (visible to every kb member — ADR-0026 made visibility the app ACL), a turnaround app whose
 * multi-hop workflow hands work across departments, and a staged "morning state" of
 * flights and expenses for the working-day agent shifts. Everything is seeded through
 * public HTTP APIs as the persona it would organically come from, so every stamp
 * (authors, responsible, computed heads, history) is produced by the substrate, never
 * hand-written. See docs/M27/02-twin-contract.md.
 */

/**
 * Job descriptions, written at handbook altitude: responsibilities and processes only —
 * never app ids (the KB welcome article owns those), view ids, or tool names. The
 * rostered personas' texts are the ENTIRE agent brief for their shift, so they name the
 * work ("scheduled flights", "ramp checks") in the same words the KB procedures use.
 */
export const TWIN_JOB_DESCRIPTIONS: Record<AirlinePersonaName, string> = {
  carol:
    "As Director of Flight Operations you run the flight schedule. You assign crew to scheduled flights, " +
    "you give dispatch sign-off on fueled flights, and you approve leave requests from flight operations staff. " +
    "Work everything that is waiting on you; leave other departments' work to them.",
  dave:
    "As First Officer you support flight planning: you create and schedule upcoming flights and file your own " +
    "expenses and leave requests. You do not approve anything.",
  erin:
    "As Cabin Services Manager you run cabin crew rostering and approve leave requests from cabin crew staff.",
  frank:
    "As Senior Cabin Crew you work assigned cabin duties and file your own expenses and leave requests.",
  hank:
    "As Ground Operations Supervisor you give fueling sign-off on flights that have passed their ramp check. " +
    "Work everything that is waiting on you; leave other departments' work to them.",
  ivy:
    "As Ramp Agent you perform ramp checks on flights with crew assigned, and you flag faults — a flagged " +
    "fault grounds the flight. Work everything that is waiting on your team; leave other departments' work to them.",
  grace:
    "As Finance Controller you process submitted expense reports: approve the compliant ones and reject the " +
    "rest, following the finance procedure. Work everything that is waiting on you."
};

/** Finance procedure threshold — the seeded expenses sit either side of it. */
export const TWIN_EXPENSE_LIMIT = 500;

export type TwinFlightKey = "alpha" | "bravo" | "charlie" | "delta";

/** Morning-state flights: key → payload and the state staging leaves them in. */
export const TWIN_FLIGHTS: Record<
  TwinFlightKey,
  { flightNumber: string; origin: string; destination: string; departureDate: string; stagedState: string }
> = {
  alpha: { flightNumber: "AA117", origin: "IST", destination: "AMS", departureDate: "2026-07-06", stagedState: "scheduled" },
  bravo: { flightNumber: "AA204", origin: "IST", destination: "LHR", departureDate: "2026-07-06", stagedState: "crew-assigned" },
  charlie: { flightNumber: "AA309", origin: "AMS", destination: "IST", departureDate: "2026-07-07", stagedState: "ramp-checked" },
  delta: { flightNumber: "AA412", origin: "LHR", destination: "IST", departureDate: "2026-07-07", stagedState: "fueled" }
};

export type TwinProcedureDepartment = "flight-ops" | "ground-ops" | "finance";

export type TwinScenario = AirlineScenario & {
  kbAppId: string;
  turnaroundAppId: string;
  flightDocIds: Record<TwinFlightKey, string>;
  expenseDocIds: { compliant: string; noncompliant: string };
  articleDocIds: { welcome: string; howWorkReachesYou: string };
  procedureDocIds: Record<TwinProcedureDepartment, string>;
};

export type SeedTwinOptions = SeedAirlineOptions & {
  kbAppId?: string;
  turnaroundAppId?: string;
};

let twinSeedSequence = 0;

type Json = Record<string, unknown>;

/** Same local helper style as scenario-agentic-airlines (kept module-private there). */
async function requestJson<T = Json>(
  context: APIRequestContext,
  method: "get" | "post" | "put",
  path: string,
  data?: unknown,
  expected: number[] = [200, 201]
): Promise<T> {
  const response = await context[method](path, data === undefined ? undefined : { data });
  if (!expected.includes(response.status())) {
    const body = await response.text();
    throw new Error(`${method.toUpperCase()} ${path} -> ${response.status()}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

async function transitionAs(
  context: APIRequestContext,
  appId: string,
  docId: string,
  transition: string
): Promise<Json> {
  return requestJson(context, "post", `/api/apps/${appId}/documents/${encodeURIComponent(docId)}/transition`, {
    transition
  });
}

/**
 * Seed the digital twin on top of `/api/reset` state. Composes `seedAgenticAirlines`
 * (same `admin` contract: an authenticated admin-session request context), then deploys
 * kb + turnaround under per-seed appIds, writes job descriptions and KB content, and
 * stages the morning state. Persona contexts used for organic staging are created and
 * disposed internally.
 */
export async function seedDigitalTwin(
  admin: APIRequestContext,
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  options: SeedTwinOptions = {}
): Promise<TwinScenario> {
  const scenario = await seedAgenticAirlines(admin, options);
  twinSeedSequence += 1;
  const kbAppId = options.kbAppId ?? `kb-t${twinSeedSequence}`;
  const turnaroundAppId = options.turnaroundAppId ?? `turnaround-t${twinSeedSequence}`;

  const personaContexts = new Map<AirlinePersonaName, APIRequestContext>();
  const as = async (username: AirlinePersonaName): Promise<APIRequestContext> => {
    const existing = personaContexts.get(username);
    if (existing) return existing;
    const context = await airlinePersonaContext(playwright, baseURL, username);
    personaContexts.set(username, context);
    return context;
  };

  try {
    // 1. Deploy the twin apps from their bundled templates (ADR-0016 per-seed appIds).
    await requestJson(
      admin,
      "post",
      "/api/platform/apps",
      { appId: kbAppId, title: "Agentic Airlines Handbook", fromTemplate: "kb" },
      [201]
    );
    await requestJson(
      admin,
      "post",
      "/api/platform/apps",
      { appId: turnaroundAppId, title: "Agentic Airlines Turnaround", fromTemplate: "turnaround" },
      [201]
    );

    // 2. KB access: the template's generic `group:employees` entries are inert here
    // (that group intentionally does not exist — see the airline fixture); grant the
    // airline groups instead. Procedure authors' departments get author level so a
    // department member can create their procedure; the rest read. The turnaround
    // app needs no grant — its template ACL already names the two working departments
    // as editors (domain groups are inherent to a flight-domain template).
    await requestJson(admin, "put", `/api/apps/${kbAppId}/access`, {
      entries: [
        { principal: "group:admins", level: "manager" },
        { principal: "group:flight-ops", level: "author" },
        { principal: "group:ground-ops", level: "author" },
        { principal: "group:finance", level: "author" },
        { principal: "group:cabin-crew", level: "reader" },
        { principal: "group:managers", level: "reader" }
      ]
    });

    // 3. Re-point definitions for the per-seed world: the turnaround computed-head
    // formulas look up the per-seed org app (same designer-level re-point as the
    // leave-request approver formula). ADR-0026: kb visibility is the app ACL above.
    const turnaroundDefinitions = await requestJson<{ forms: Array<Json & { _id: string }> }>(
      admin,
      "get",
      `/api/apps/${turnaroundAppId}/definitions`
    );
    const flightForm = turnaroundDefinitions.forms.find((definition) => definition._id === "form:flight");
    if (!flightForm) throw new Error("turnaround app is missing form:flight");
    const repointedFlightForm = JSON.parse(
      JSON.stringify(flightForm).split("DbLookup('org'").join(`DbLookup('${scenario.orgAppId}'`)
    );
    await requestJson(
      admin,
      "put",
      `/api/apps/${turnaroundAppId}/definitions/${encodeURIComponent("form:flight")}`,
      repointedFlightForm
    );

    // 4. Job descriptions onto the org chart (plain payload update — the field is
    // optional data on form:employee, no definition edit needed).
    for (const [username, docId] of Object.entries(scenario.employeeDocIds)) {
      const employee = await requestJson<{ payload: Json }>(
        admin,
        "get",
        `/api/apps/${scenario.orgAppId}/documents/${encodeURIComponent(docId)}`
      );
      await requestJson(admin, "put", `/api/apps/${scenario.orgAppId}/documents/${encodeURIComponent(docId)}`, {
        payload: { ...employee.payload, jobDescription: TWIN_JOB_DESCRIPTIONS[username as AirlinePersonaName] }
      });
    }

    // 5. Handbook articles (admin author: company-wide via the re-pointed
    // defaultReaders). The welcome article is the agents' single root pointer — it is
    // where app discovery resolves, so it names every per-seed appId.
    const welcome = await requestJson<{ _id: string }>(
      admin,
      "post",
      `/api/apps/${kbAppId}/documents`,
      {
        docType: "article",
        payload: {
          title: "Welcome to Agentic Airlines PLC",
          body:
            "Agentic Airlines PLC flies short-haul routes with four departments: Flight Operations, Cabin Crew, " +
            "Ground Operations, and Finance. Company systems, by app id:\n" +
            `- "${scenario.orgAppId}" — the organization: departments, employees, reporting lines, job descriptions.\n` +
            `- "${kbAppId}" — this handbook: articles for everyone, procedures for your team.\n` +
            `- "${turnaroundAppId}" — flight turnaround: every flight moves from planning to dispatch here.\n` +
            `- "${scenario.leaveRequestAppId}" — leave requests: file your own; department heads approve.\n` +
            '- "expense" — expense reports: file your own; finance processes them.\n' +
            "Your team's procedures in the handbook describe how your department works."
        }
      },
      [201]
    );
    const howWorkReachesYou = await requestJson<{ _id: string }>(
      admin,
      "post",
      `/api/apps/${kbAppId}/documents`,
      {
        docType: "article",
        payload: {
          title: "How work reaches you",
          body:
            "Work at Agentic Airlines is assigned, not announced. When a document is waiting on you or your team, " +
            "it is assigned to you and appears in that app's personal queue views (My Queue, My Approvals). Start " +
            "your day from those queues, do what your job description and your team's procedures say, and the next " +
            "step is routed to whoever owns it — you never hand work over manually."
        }
      },
      [201]
    );

    // 6. Department procedures — created BY a department member, who becomes the
    // procedure's author (edit rights). Every kb member can read them (ADR-0026).
    const procedureDocIds = {} as Record<TwinProcedureDepartment, string>;
    const procedures: Array<{ department: TwinProcedureDepartment; author: AirlinePersonaName; title: string; body: string }> = [
      {
        department: "flight-ops",
        author: "dave",
        title: "Flight operations: scheduling, crew, and dispatch",
        body:
          "Planning creates and schedules upcoming flights in the Turnaround app. The head of flight operations " +
          "assigns crew to scheduled flights, and gives dispatch sign-off on fueled flights — dispatch is the last " +
          "step; once dispatched a flight is done. Leave requests from flight operations staff are approved by the " +
          "head of flight operations."
      },
      {
        department: "ground-ops",
        author: "ivy",
        title: "Ground operations: ramp checks and fueling",
        body:
          "Ground operations owns every flight with crew assigned. A ramp agent performs the ramp check and records " +
          "it in the Turnaround app; a fault found on the ramp is flagged and grounds the flight. Flights that pass " +
          "the ramp check go to the ground operations supervisor for fueling sign-off."
      },
      {
        department: "finance",
        author: "grace",
        title: "Finance: expense processing",
        body:
          `Submitted expense reports are processed daily. Approve an expense when its amount is ${TWIN_EXPENSE_LIMIT} ` +
          `or less and the description states a clear business purpose. Reject any expense over ${TWIN_EXPENSE_LIMIT} — ` +
          "no exceptions; the requester can resubmit a corrected claim."
      }
    ];
    for (const procedure of procedures) {
      const author = await as(procedure.author);
      const doc = await requestJson<{ _id: string }>(
        author,
        "post",
        `/api/apps/${kbAppId}/documents`,
        {
          docType: "procedure",
          payload: { title: procedure.title, department: procedure.department, body: procedure.body }
        },
        [201]
      );
      procedureDocIds[procedure.department] = doc._id;
    }

    // 7. Morning state: flights, created and scheduled by dave (flight planning) and
    // walked to their staged state by the personas who own each hop, so responsibles,
    // computed heads, authors, audit, and history are all organically stamped.
    const dave = await as("dave");
    const carol = await as("carol");
    const ivy = await as("ivy");
    const hank = await as("hank");
    const flightDocIds = {} as Record<TwinFlightKey, string>;
    for (const [key, flight] of Object.entries(TWIN_FLIGHTS) as Array<[TwinFlightKey, (typeof TWIN_FLIGHTS)[TwinFlightKey]]>) {
      const doc = await requestJson<{ _id: string }>(
        dave,
        "post",
        `/api/apps/${turnaroundAppId}/documents`,
        {
          docType: "flight",
          payload: {
            flightNumber: flight.flightNumber,
            origin: flight.origin,
            destination: flight.destination,
            departureDate: flight.departureDate
          }
        },
        [201]
      );
      flightDocIds[key] = doc._id;
      await transitionAs(dave, turnaroundAppId, doc._id, "schedule");
      if (flight.stagedState === "scheduled") continue;
      await transitionAs(carol, turnaroundAppId, doc._id, "assign-crew");
      if (flight.stagedState === "crew-assigned") continue;
      await transitionAs(ivy, turnaroundAppId, doc._id, "ramp-check");
      if (flight.stagedState === "ramp-checked") continue;
      await transitionAs(hank, turnaroundAppId, doc._id, "fuel-signoff");
    }

    // 8. Morning expenses, either side of the finance limit: dave's is compliant,
    // frank's is not (grace's shift must find one approve and one reject). The expense
    // sample data seeded by /api/reset includes an already-submitted expense — grace
    // clears any such leftovers first ("yesterday's queue"), so the morning queue is
    // exactly the two staged documents and the agent-tier oracles stay deterministic.
    const grace = await as("grace");
    const preExisting = await requestJson<Array<{ _id: string; state?: string }>>(
      grace,
      "get",
      "/api/apps/expense/documents?docType=expense"
    );
    for (const leftover of preExisting.filter((doc) => doc.state === "submitted")) {
      await transitionAs(grace, "expense", leftover._id, "reject");
    }
    const frank = await as("frank");
    const expenseDocIds = { compliant: "", noncompliant: "" };
    const compliant = await requestJson<{ _id: string }>(
      dave,
      "post",
      "/api/apps/expense/documents",
      {
        docType: "expense",
        payload: {
          amount: 120,
          description: "Airport taxi after the AMS late arrival",
          category: "travel",
          spentAt: "2026-07-02"
        }
      },
      [201]
    );
    expenseDocIds.compliant = compliant._id;
    await transitionAs(dave, "expense", compliant._id, "submit");
    const noncompliant = await requestJson<{ _id: string }>(
      frank,
      "post",
      "/api/apps/expense/documents",
      {
        docType: "expense",
        payload: {
          amount: 950,
          description: "Hotel room upgrade during the LHR layover",
          category: "travel",
          spentAt: "2026-07-01"
        }
      },
      [201]
    );
    expenseDocIds.noncompliant = noncompliant._id;
    await transitionAs(frank, "expense", noncompliant._id, "submit");

    return {
      ...scenario,
      kbAppId,
      turnaroundAppId,
      flightDocIds,
      expenseDocIds,
      articleDocIds: { welcome: welcome._id, howWorkReachesYou: howWorkReachesYou._id },
      procedureDocIds
    };
  } finally {
    await Promise.all([...personaContexts.values()].map((context) => context.dispose()));
  }
}
