/** Factory for a minimal, valid, desktop-openable empty project. */
import type { Project, TaskPropertyDef } from "./types.js";

const DEFAULT_TASK_PROPERTIES: TaskPropertyDef[] = [
  { id: "tpd0", name: "type", type: "default", valuetype: "icon" },
  { id: "tpd1", name: "priority", type: "default", valuetype: "icon" },
  { id: "tpd2", name: "info", type: "default", valuetype: "icon" },
  { id: "tpd3", name: "name", type: "default", valuetype: "text" },
  { id: "tpd4", name: "begindate", type: "default", valuetype: "date" },
  { id: "tpd5", name: "enddate", type: "default", valuetype: "date" },
  { id: "tpd6", name: "duration", type: "default", valuetype: "int" },
  { id: "tpd7", name: "completion", type: "default", valuetype: "int" },
  { id: "tpd8", name: "coordinator", type: "default", valuetype: "text" },
  { id: "tpd9", name: "predecessorsr", type: "default", valuetype: "text" },
];

export function emptyProject(name = ""): Project {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name,
    company: "",
    webLink: "",
    viewDate: today,
    version: "3.3.3309",
    locale: "en",
    description: "",
    views: [
      { id: "gantt-chart", zoomingState: "default:6", fields: [], options: [] },
      { id: "resource-table", fields: [], options: [] },
    ],
    calendar: {
      defaultWeek: { id: "1", name: "default", sun: "1", mon: "0", tue: "0", wed: "0", thu: "0", fri: "0", sat: "1" },
      onlyShowWeekends: false,
      holidays: [],
    },
    emptyMilestones: true,
    taskPropertyDefs: DEFAULT_TASK_PROPERTIES.map((d) => ({ ...d })),
    tasks: [],
    resources: [],
    allocations: [],
    vacations: [],
    roleSets: [{ rolesetName: "Default", roles: [] }],
  };
}
