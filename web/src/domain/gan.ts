/**
 * `.gan` (GanttProject XML) parser and serializer.
 *
 * The desktop format is a single self-contained XML document. This module maps
 * it to/from the typed {@link Project} model. The contract verified by the tests
 * is a stable semantic round trip: parse -> serialize -> parse yields an equal
 * model, and known values from a real document are extracted correctly.
 *
 * Note: original insignificant whitespace (e.g. inside <notes> CDATA) is not
 * preserved byte-for-byte; the round trip is idempotent on the structured model.
 */
import { XMLParser } from "fast-xml-parser";
import {
  type Allocation,
  type Calendar,
  type CalendarHoliday,
  type CustomPropertyValue,
  type DependencyHardness,
  DependencyType,
  type Project,
  type Resource,
  type Role,
  type RoleSet,
  type Task,
  type TaskDependency,
  type TaskPropertyDef,
  type Vacation,
  type View,
} from "./types.js";

const ATTR = "@_";
const CDATA = "__cdata";
const TEXT = "#text";

const ARRAY_TAGS = new Set([
  "view",
  "field",
  "option",
  "day-type",
  "date",
  "task",
  "depend",
  "customproperty",
  "taskproperty",
  "resource",
  "allocation",
  "vacation",
  "role",
  "roles",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  textNodeName: TEXT,
  cdataPropName: CDATA,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

// ---------------------------------------------------------------------------
// Small helpers over the loosely-typed parsed tree.
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

function attr(node: Node | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const v = node[ATTR + name];
  return v === undefined || v === null ? undefined : String(v);
}

function attrOr(node: Node | undefined, name: string, fallback: string): string {
  return attr(node, name) ?? fallback;
}

function bool(node: Node | undefined, name: string): boolean {
  return attr(node, name) === "true";
}

function num(node: Node | undefined, name: string, fallback = 0): number {
  const v = attr(node, name);
  return v === undefined ? fallback : Number(v);
}

function arr(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as Node[]) : [value as Node];
}

function cdata(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const c = node[CDATA];
  if (c !== undefined && c !== null) return String(c);
  const t = node[TEXT];
  return t === undefined || t === null ? undefined : String(t);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parseGan(xml: string): Project {
  const root = parser.parse(xml) as Node;
  const p = root.project as Node;
  if (!p) throw new Error("Invalid .gan: missing <project> root element");

  const tasksNode = p.tasks as Node | undefined;

  return {
    name: attrOr(p, "name", ""),
    company: attrOr(p, "company", ""),
    webLink: attrOr(p, "webLink", ""),
    viewDate: attrOr(p, "view-date", ""),
    viewIndex: attr(p, "view-index"),
    ganttDividerLocation: attr(p, "gantt-divider-location"),
    resourceDividerLocation: attr(p, "resource-divider-location"),
    version: attrOr(p, "version", ""),
    locale: attrOr(p, "locale", ""),
    description: cdata(p.description as Node) ?? "",
    views: arr(p.view).map(parseView),
    calendar: parseCalendar(p.calendars as Node | undefined),
    emptyMilestones: tasksNode ? bool(tasksNode, "empty-milestones") : undefined,
    taskPropertyDefs: parseTaskPropertyDefs(tasksNode),
    tasks: arr(tasksNode?.task).map(parseTask),
    resources: arr((p.resources as Node | undefined)?.resource).map(parseResource),
    allocations: arr((p.allocations as Node | undefined)?.allocation).map(parseAllocation),
    vacations: arr((p.vacations as Node | undefined)?.vacation).map(parseVacation),
    roleSets: arr(p.roles).map(parseRoleSet),
  };
}

function parseView(node: Node): View {
  return {
    id: attrOr(node, "id", ""),
    zoomingState: attr(node, "zooming-state"),
    fields: arr(node.field).map((f) => attrsToRecord(f)),
    options: arr(node.option).map((o) => ({
      id: attrOr(o, "id", ""),
      value: attr(o, "value"),
      cdata: cdata(o),
    })),
    timeline: cdata(node.timeline as Node),
  };
}

function attrsToRecord(node: Node): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(node)) {
    if (key.startsWith(ATTR)) out[key.slice(ATTR.length)] = String(node[key]);
  }
  return out;
}

function parseCalendar(node: Node | undefined): Calendar {
  const dayTypes = node?.["day-types"] as Node | undefined;
  const defaultWeekNode = dayTypes?.["default-week"] as Node | undefined;
  const onlyShow = dayTypes?.["only-show-weekends"] as Node | undefined;
  return {
    baseId: attr(node, "base-id"),
    defaultWeek: defaultWeekNode ? attrsToRecord(defaultWeekNode) : undefined,
    onlyShowWeekends: onlyShow ? bool(onlyShow, "value") : undefined,
    holidays: arr(node?.date).map(
      (d): CalendarHoliday => ({
        year: attr(d, "year"),
        month: attrOr(d, "month", ""),
        date: attrOr(d, "date", ""),
        type: attr(d, "type"),
      }),
    ),
  };
}

function parseTaskPropertyDefs(tasksNode: Node | undefined): TaskPropertyDef[] {
  const tp = tasksNode?.taskproperties as Node | undefined;
  return arr(tp?.taskproperty).map((n): TaskPropertyDef => {
    const def: TaskPropertyDef = {
      id: attrOr(n, "id", ""),
      name: attrOr(n, "name", ""),
      type: attrOr(n, "type", ""),
      valuetype: attrOr(n, "valuetype", ""),
    };
    const dv = attr(n, "defaultvalue");
    if (dv !== undefined) def.defaultvalue = dv;
    const sel = n["simple-select"] as Node | undefined;
    if (sel) def.rawInner = `<simple-select select="${escapeAttr(attrOr(sel, "select", ""))}"/>`;
    return def;
  });
}

function parseTask(node: Node): Task {
  const task: Task = {
    id: attrOr(node, "id", ""),
    uid: attrOr(node, "uid", ""),
    name: attrOr(node, "name", ""),
    color: attr(node, "color"),
    meeting: bool(node, "meeting"),
    start: attrOr(node, "start", ""),
    duration: num(node, "duration"),
    complete: num(node, "complete"),
    expand: attr(node, "expand") === undefined ? true : bool(node, "expand"),
    notes: cdata(node.notes as Node),
    thirdDate: attr(node, "thirdDate"),
    thirdDateConstraint:
      attr(node, "thirdDate-constraint") === undefined
        ? undefined
        : num(node, "thirdDate-constraint"),
    costManualValue: attr(node, "cost-manual-value"),
    costCalculated:
      attr(node, "cost-calculated") === undefined ? undefined : bool(node, "cost-calculated"),
    priority: attr(node, "priority"),
    webLink: attr(node, "webLink"),
    shape: attr(node, "shape"),
    dependencies: arr(node.depend).map(parseDependency),
    customProperties: arr(node.customproperty).map(parseCustomProperty),
    children: arr(node.task).map(parseTask),
  };
  return task;
}

function parseDependency(node: Node): TaskDependency {
  return {
    successorId: attrOr(node, "id", ""),
    type: (num(node, "type", DependencyType.FinishStart) as DependencyType),
    difference: num(node, "difference"),
    hardness: (attrOr(node, "hardness", "Strong") as DependencyHardness),
  };
}

function parseCustomProperty(node: Node): CustomPropertyValue {
  return {
    taskpropertyId: attrOr(node, "taskproperty-id", ""),
    value: attrOr(node, "value", ""),
  };
}

function parseResource(node: Node): Resource {
  const rate = node.rate as Node | undefined;
  return {
    id: attrOr(node, "id", ""),
    name: attrOr(node, "name", ""),
    function: attr(node, "function"),
    contacts: attr(node, "contacts"),
    phone: attr(node, "phone"),
    rate: rate
      ? { name: attrOr(rate, "name", ""), value: attrOr(rate, "value", "") }
      : undefined,
  };
}

function parseAllocation(node: Node): Allocation {
  return {
    taskId: attrOr(node, "task-id", ""),
    resourceId: attrOr(node, "resource-id", ""),
    function: attr(node, "function"),
    responsible: bool(node, "responsible"),
    load: num(node, "load"),
  };
}

function parseVacation(node: Node): Vacation {
  return {
    start: attrOr(node, "start", ""),
    end: attrOr(node, "end", ""),
    resourceId: attrOr(node, "resourceid", ""),
  };
}

function parseRoleSet(node: Node): RoleSet {
  return {
    rolesetName: attr(node, "roleset-name"),
    roles: arr(node.role).map(
      (r): Role => ({ id: attrOr(r, "id", ""), name: attrOr(r, "name", "") }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function a(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  return ` ${name}="${escapeAttr(String(value))}"`;
}

export function serializeGan(p: Project): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<project${a("name", p.name)}${a("company", p.company)}${a("webLink", p.webLink)}` +
      `${a("view-date", p.viewDate)}${a("view-index", p.viewIndex)}` +
      `${a("gantt-divider-location", p.ganttDividerLocation)}` +
      `${a("resource-divider-location", p.resourceDividerLocation)}` +
      `${a("version", p.version)}${a("locale", p.locale)}>`,
  );

  if (p.description) lines.push(`  <description><![CDATA[${p.description}]]></description>`);
  else lines.push("  <description/>");

  for (const v of p.views) serializeView(v, lines);
  serializeCalendar(p.calendar, lines);

  lines.push(`  <tasks${p.emptyMilestones !== undefined ? a("empty-milestones", p.emptyMilestones) : ""}>`);
  serializeTaskPropertyDefs(p.taskPropertyDefs, lines);
  for (const t of p.tasks) serializeTask(t, lines, 2);
  lines.push("  </tasks>");

  lines.push("  <resources>");
  for (const r of p.resources) serializeResource(r, lines);
  lines.push("  </resources>");

  lines.push("  <allocations>");
  for (const al of p.allocations) {
    lines.push(
      `    <allocation${a("task-id", al.taskId)}${a("resource-id", al.resourceId)}` +
        `${a("function", al.function)}${a("responsible", al.responsible)}${a("load", al.load)}/>`,
    );
  }
  lines.push("  </allocations>");

  lines.push("  <vacations>");
  for (const vac of p.vacations) {
    lines.push(
      `    <vacation${a("start", vac.start)}${a("end", vac.end)}${a("resourceid", vac.resourceId)}/>`,
    );
  }
  lines.push("  </vacations>");

  for (const rs of p.roleSets) serializeRoleSet(rs, lines);

  lines.push("</project>");
  return lines.join("\n");
}

function serializeView(v: View, lines: string[]): void {
  lines.push(`  <view${a("zooming-state", v.zoomingState)}${a("id", v.id)}>`);
  for (const f of v.fields) {
    let s = "    <field";
    for (const [k, val] of Object.entries(f)) s += a(k, val);
    lines.push(s + "/>");
  }
  for (const o of v.options) {
    if (o.cdata !== undefined) lines.push(`    <option${a("id", o.id)}><![CDATA[${o.cdata}]]></option>`);
    else lines.push(`    <option${a("id", o.id)}${a("value", o.value)}/>`);
  }
  if (v.timeline !== undefined) lines.push(`    <timeline><![CDATA[${v.timeline}]]></timeline>`);
  lines.push("  </view>");
}

function serializeCalendar(c: Calendar, lines: string[]): void {
  lines.push(`  <calendars${a("base-id", c.baseId)}>`);
  lines.push("    <day-types>");
  // GanttProject always emits day-type 0 and 1.
  lines.push('      <day-type id="0"/>');
  lines.push('      <day-type id="1"/>');
  if (c.defaultWeek) {
    let s = "      <default-week";
    for (const [k, val] of Object.entries(c.defaultWeek)) s += a(k, val);
    lines.push(s + "/>");
  }
  if (c.onlyShowWeekends !== undefined) {
    lines.push(`      <only-show-weekends${a("value", c.onlyShowWeekends)}/>`);
  }
  lines.push("      <overriden-day-types/>");
  lines.push("      <days/>");
  lines.push("    </day-types>");
  for (const h of c.holidays) {
    lines.push(
      `    <date${a("year", h.year)}${a("month", h.month)}${a("date", h.date)}${a("type", h.type)}/>`,
    );
  }
  lines.push("  </calendars>");
}

function serializeTaskPropertyDefs(defs: TaskPropertyDef[], lines: string[]): void {
  lines.push("    <taskproperties>");
  for (const d of defs) {
    const open =
      `      <taskproperty${a("id", d.id)}${a("name", d.name)}${a("type", d.type)}` +
      `${a("valuetype", d.valuetype)}${a("defaultvalue", d.defaultvalue)}`;
    if (d.rawInner) {
      lines.push(open + ">");
      lines.push(`        ${d.rawInner}`);
      lines.push("      </taskproperty>");
    } else {
      lines.push(open + "/>");
    }
  }
  lines.push("    </taskproperties>");
}

function serializeTask(t: Task, lines: string[], depth: number): void {
  const pad = "  ".repeat(depth);
  const open =
    `${pad}<task${a("id", t.id)}${a("uid", t.uid)}${a("name", t.name)}${a("color", t.color)}` +
    `${a("meeting", t.meeting)}${a("start", t.start)}${a("duration", t.duration)}` +
    `${a("complete", t.complete)}${a("thirdDate", t.thirdDate)}` +
    `${t.thirdDateConstraint !== undefined ? a("thirdDate-constraint", t.thirdDateConstraint) : ""}` +
    `${a("priority", t.priority)}${a("webLink", t.webLink)}${a("shape", t.shape)}` +
    `${a("expand", t.expand)}${a("cost-manual-value", t.costManualValue)}` +
    `${t.costCalculated !== undefined ? a("cost-calculated", t.costCalculated) : ""}`;

  const hasChildren =
    t.notes !== undefined ||
    t.dependencies.length > 0 ||
    t.customProperties.length > 0 ||
    t.children.length > 0;

  if (!hasChildren) {
    lines.push(open + "/>");
    return;
  }
  lines.push(open + ">");
  const cpad = "  ".repeat(depth + 1);
  if (t.notes !== undefined) lines.push(`${cpad}<notes><![CDATA[${t.notes}]]></notes>`);
  for (const d of t.dependencies) {
    lines.push(
      `${cpad}<depend${a("id", d.successorId)}${a("type", d.type)}` +
        `${a("difference", d.difference)}${a("hardness", d.hardness)}/>`,
    );
  }
  for (const cp of t.customProperties) {
    lines.push(`${cpad}<customproperty${a("taskproperty-id", cp.taskpropertyId)}${a("value", cp.value)}/>`);
  }
  for (const child of t.children) serializeTask(child, lines, depth + 1);
  lines.push(`${pad}</task>`);
}

function serializeResource(r: Resource, lines: string[]): void {
  const open =
    `    <resource${a("id", r.id)}${a("name", r.name)}${a("function", r.function)}` +
    `${a("contacts", r.contacts)}${a("phone", r.phone)}`;
  if (r.rate) {
    lines.push(open + ">");
    lines.push(`      <rate${a("name", r.rate.name)}${a("value", r.rate.value)}/>`);
    lines.push("    </resource>");
  } else {
    lines.push(open + "/>");
  }
}

function serializeRoleSet(rs: RoleSet, lines: string[]): void {
  if (rs.roles.length === 0) {
    lines.push(`  <roles${a("roleset-name", rs.rolesetName)}/>`);
    return;
  }
  lines.push(`  <roles${a("roleset-name", rs.rolesetName)}>`);
  for (const role of rs.roles) lines.push(`    <role${a("id", role.id)}${a("name", role.name)}/>`);
  lines.push("  </roles>");
}
