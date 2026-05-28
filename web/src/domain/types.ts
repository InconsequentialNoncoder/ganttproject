/**
 * Typed domain model for a GanttProject document.
 *
 * Field names mirror the `.gan` XML schema (see fixtures/HouseBuildingSample.gan)
 * so that import/export round-trips stay compatible with the desktop application.
 */

/** Dependency constraint type as stored in `.gan` (`<depend type="...">`). */
export enum DependencyType {
  StartStart = 1,
  FinishStart = 2,
  FinishFinish = 3,
  StartFinish = 4,
}

/** Dependency hardness; "Rubber" dependencies do not force rescheduling. */
export type DependencyHardness = "Strong" | "Rubber";

export interface TaskDependency {
  /**
   * `id` attribute = the successor task. The `<depend>` element is stored on
   * the predecessor task, so the task owning this dependency runs first and
   * `successorId` runs after it (subject to {@link type} and {@link difference}).
   */
  successorId: string;
  type: DependencyType;
  /** Lag/lead offset in calendar units. */
  difference: number;
  hardness: DependencyHardness;
}

export interface CustomPropertyValue {
  taskpropertyId: string;
  value: string;
}

export interface Task {
  id: string;
  uid: string;
  name: string;
  /** Hex color string, e.g. "#99ccff", or undefined to inherit the default. */
  color?: string;
  /** A milestone (`meeting="true"`). */
  meeting: boolean;
  /** ISO date "YYYY-MM-DD". */
  start: string;
  /** Duration in calendar working units. */
  duration: number;
  /** Completion percentage 0..100. */
  complete: number;
  expand: boolean;
  notes?: string;
  thirdDate?: string;
  thirdDateConstraint?: number;
  costManualValue?: string;
  costCalculated?: boolean;
  priority?: string;
  webLink?: string;
  shape?: string;
  dependencies: TaskDependency[];
  customProperties: CustomPropertyValue[];
  /** Child tasks (hierarchy). */
  children: Task[];
}

export interface TaskPropertyDef {
  id: string;
  name: string;
  type: string;
  valuetype: string;
  defaultvalue?: string;
  /** Raw inner XML preserved verbatim (e.g. <simple-select select="..."/>). */
  rawInner?: string;
}

export interface ResourceRate {
  name: string;
  value: string;
}

export interface Resource {
  id: string;
  name: string;
  /** Role reference, e.g. "1" or "Default:1". */
  function?: string;
  contacts?: string;
  phone?: string;
  rate?: ResourceRate;
}

export interface Allocation {
  taskId: string;
  resourceId: string;
  function?: string;
  responsible: boolean;
  /** Load percentage. */
  load: number;
}

export interface Vacation {
  start: string;
  end: string;
  resourceId: string;
}

export interface Role {
  id: string;
  name: string;
}

export interface RoleSet {
  /** roleset-name attribute; absent for the inline custom role set. */
  rolesetName?: string;
  roles: Role[];
}

export interface CalendarHoliday {
  year?: string;
  month: string;
  date: string;
  type?: string;
}

export interface Calendar {
  baseId?: string;
  /** Per-weekday flags: "0" = working, "1" = non-working (as stored in `.gan`). */
  defaultWeek?: Record<string, string>;
  onlyShowWeekends?: boolean;
  holidays: CalendarHoliday[];
  /** Preserved verbatim so unmodeled calendar details survive a round trip. */
  rawDayTypesExtra?: string;
}

/** A `<view>` block (gantt-chart / resource-table). Preserved structurally. */
export interface View {
  id: string;
  zoomingState?: string;
  fields: Array<Record<string, string>>;
  options: Array<{ id: string; value?: string; cdata?: string }>;
  timeline?: string;
}

export interface Project {
  name: string;
  company: string;
  webLink: string;
  viewDate: string;
  viewIndex?: string;
  ganttDividerLocation?: string;
  resourceDividerLocation?: string;
  version: string;
  locale: string;
  description: string;
  views: View[];
  calendar: Calendar;
  /** `empty-milestones` attribute on <tasks>. */
  emptyMilestones?: boolean;
  taskPropertyDefs: TaskPropertyDef[];
  tasks: Task[];
  resources: Resource[];
  allocations: Allocation[];
  vacations: Vacation[];
  roleSets: RoleSet[];
}

/** Walk the task tree depth-first (parent before children). */
export function walkTasks(
  tasks: Task[],
  visit: (task: Task, parent: Task | null) => void,
  parent: Task | null = null,
): void {
  for (const task of tasks) {
    visit(task, parent);
    walkTasks(task.children, visit, task);
  }
}
