"use client";

import {
  Archive,
  BarChart3,
  BedDouble,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudOff,
  Clock3,
  Download,
  Eye,
  FileDown,
  Hotel,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Trash2,
  UserPlus,
  UsersRound,
  Wifi,
  Wrench,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createCloudTechnicalIncident,
  getCloudTechnicalPhotoUrl,
  getCloudClient,
  listCloudTechnicalActivity,
  listCloudTechnicalIncidents,
  listCloudMembers,
  resolveCloudContext,
  type CloudTechnicalActivity,
  type CloudTechnicalIncident,
  type CloudTechnicalWorkflow,
  type CloudContext,
  updateCloudTechnicalIncident,
  uploadCloudTechnicalPhoto,
  upsertCloudMember,
} from "../lib/cloud";

type PageId = "dashboard" | "distribution" | "personnel" | "reports" | "settings";
type DashboardView = "rooms" | "commons";
type RoomStatus = "OP" | "OS" | "LP" | "LS";
type Progress = "À faire" | "En cours" | "Terminée" | "Contrôlée" | "Validée sans contrôle";
type DeliveryMethod = "phone" | "pdf";
type DayIntervention = "À blanc" | "Recouche" | "Libre";
type DistributionStep = "team" | "assign";
type DistributionInterventionFilter = "all" | "blank" | "stayover";
type DistributionAssigneeFilter = "all" | "unassigned" | string;
type DepartureState = "Présent" | "Parti";
type PersonnelView = "active" | "archived";
type TechnicalStatus = "Détecté" | "Signalé" | "En cours" | "Réparé";
type CommonAreaAction = "Ménage" | "Problème technique";
type AccountRole =
  | "Administrateur"
  | "Adjoint(e) de direction"
  | "Gouvernante"
  | "Chef de réception"
  | "Réception"
  | "Responsable technique";

type AnnexTask = {
  id: number;
  label: string;
  minutes: number;
};

type UserAccount = {
  id: number;
  name: string;
  email?: string;
  role: AccountRole;
  active: boolean;
  membershipId?: string;
  userId?: string | null;
};

type Room = {
  id: number;
  number: string;
  category: string;
  layout: string;
  defaultLayout: string;
  status: RoomStatus;
  intervention: DayIntervention | null;
  outOfService: boolean;
  departureState?: DepartureState;
  housekeeper: string;
  progress: Progress;
  arrivalToday: boolean;
  alert?: "DND" | "Refus de service" | "Problème technique";
  technicalStatus?: TechnicalStatus;
  technicalIncidentId?: number;
  technicalPhotoKey?: string;
  technicalPhotoName?: string;
  technicalPhotoData?: string;
  receptionComment?: string;
  floorComment?: string;
};

type CommonArea = {
  id: string;
  name: string;
  active?: boolean;
  completed: boolean;
  action?: CommonAreaAction;
  comment?: string;
  assignee?: string;
  minutes?: number;
  technicalStatus?: TechnicalStatus;
  technicalIncidentId?: number;
  technicalPhotoKey?: string;
  technicalPhotoName?: string;
  technicalPhotoData?: string;
};

type CommonAreaErrors = {
  comment?: boolean;
  assignee?: boolean;
  minutes?: boolean;
};

type DistributionAlert = {
  id: string;
  kind: "equity" | "floors" | "overrun";
  title: string;
  detail: string;
  employeeNames: string[];
};

type AlertSettings = {
  equity: boolean;
  floors: boolean;
  overrun: boolean;
};

type Employee = {
  id: number;
  name: string;
  lastName: string;
  contract: string;
  start: string;
  end: string;
  presenceMinutes: number;
  pause: number;
  annexTasks: AnnexTask[];
  active: boolean;
  presentToday: boolean;
  delivery: DeliveryMethod;
};

type SyncStatus = "loading" | "local" | "saving" | "synced" | "offline" | "error";

type AppSnapshot = {
  schemaVersion: 1;
  workDate: string;
  rooms: Room[];
  commonAreas: CommonArea[];
  employees: Employee[];
  accounts: UserAccount[];
  blankMinutes: number;
  stayoverMinutes: number;
  defaultPauseMinutes: number;
  alertSettings: AlertSettings;
  hotelName: string;
  groupName: string;
  hotelAddress: string;
  hotelLogo: string;
  groupLogo: string;
  predefinedInstructions: string[];
  reportComment: string;
  savedAt: string;
};

const SNAPSHOT_VERSION = 1 as const;
const LOCAL_STORAGE_PREFIX = "raccoon-housekeeping:v1";

function todayIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function safeDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function longDateLabel(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(safeDate(value));
}

function shortDateLabel(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(safeDate(value));
}

function timeLabel(value: Date = new Date()) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(value);
}

function dayStorageKey(workDate: string) {
  return `${LOCAL_STORAGE_PREFIX}:day:${workDate}`;
}

const employeeDirectoryStorageKey = `${LOCAL_STORAGE_PREFIX}:permanent:employees`;
const outOfServiceStorageKey = `${LOCAL_STORAGE_PREFIX}:permanent:out-of-service`;
const permanentSettingsStorageKey = `${LOCAL_STORAGE_PREFIX}:permanent:hotel-settings`;

type PermanentHotelSettings = Pick<AppSnapshot,
  | "accounts"
  | "commonAreas"
  | "blankMinutes"
  | "stayoverMinutes"
  | "defaultPauseMinutes"
  | "alertSettings"
  | "hotelName"
  | "groupName"
  | "hotelAddress"
  | "hotelLogo"
  | "groupLogo"
  | "predefinedInstructions"
>;

type PermanentCloudSnapshot = PermanentHotelSettings & {
  schemaVersion: 2;
  employees: Employee[];
  rooms: Room[];
  outOfServiceRooms: string[];
  savedAt: string;
};

function employeeDirectoryRecord(employee: Employee): Employee {
  return { ...employee, annexTasks: [], presentToday: false };
}

function permanentRoomRecord(room: Room): Room {
  return {
    ...room,
    layout: room.defaultLayout,
    status: room.outOfService ? room.status : "LP",
    intervention: null,
    departureState: undefined,
    housekeeper: "",
    progress: "À faire",
    arrivalToday: false,
    alert: undefined,
    technicalStatus: undefined,
    technicalPhotoName: undefined,
    technicalPhotoData: undefined,
    receptionComment: undefined,
    floorComment: undefined,
  };
}

function permanentCommonAreaRecord(area: CommonArea): CommonArea {
  return {
    id: area.id,
    name: area.name,
    active: area.active !== false,
    completed: false,
  };
}

function mergeCommonAreasWithPermanent(dayAreas: CommonArea[], permanentAreas: CommonArea[]) {
  const source = permanentAreas.length ? permanentAreas : dayAreas;
  return source.map((profile) => {
    const day = dayAreas.find((area) => area.id === profile.id || area.name === profile.name);
    return {
      ...profile,
      ...(day ?? {}),
      id: profile.id,
      name: profile.name,
      active: profile.active !== false,
    };
  });
}

function mergeRoomsWithPermanent(dayRooms: Room[], permanentRooms: Room[], outOfServiceRooms: Set<string>) {
  const source = permanentRooms.length ? permanentRooms : dayRooms;
  return source.map((profile) => {
    const day = dayRooms.find((room) => room.number === profile.number);
    return {
      ...profile,
      ...(day ?? {}),
      id: profile.id,
      number: profile.number,
      category: profile.category,
      defaultLayout: profile.defaultLayout,
      layout: day?.layout ?? profile.defaultLayout,
      outOfService: outOfServiceRooms.has(profile.number),
      status: outOfServiceRooms.has(profile.number) ? (day?.status ?? profile.status) : (day?.status ?? "LP"),
    };
  });
}

function readEmployeeDirectory() {
  try {
    const raw = window.localStorage.getItem(employeeDirectoryStorageKey);
    const parsed = raw ? JSON.parse(raw) as Employee[] : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeEmployeeDirectory(employees: Employee[]) {
  try {
    window.localStorage.setItem(employeeDirectoryStorageKey, JSON.stringify(employees.map(employeeDirectoryRecord)));
  } catch {
    // La sauvegarde quotidienne reste disponible si le navigateur refuse le stockage permanent.
  }
}

function mergeEmployeesWithDirectory(dayEmployees: Employee[], directory: Employee[]) {
  return directory.map((profile) => {
    const day = dayEmployees.find((employee) => employee.id === profile.id);
    return {
      ...profile,
      start: day?.start ?? profile.start,
      end: day?.end ?? profile.end,
      presenceMinutes: day?.presenceMinutes ?? profile.presenceMinutes,
      pause: day?.pause ?? profile.pause,
      annexTasks: day?.annexTasks ?? [],
      presentToday: day?.presentToday ?? false,
    };
  });
}

function readPersistentOutOfServiceRooms() {
  try {
    const raw = window.localStorage.getItem(outOfServiceStorageKey);
    const parsed = raw ? JSON.parse(raw) as string[] : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

function writePersistentOutOfServiceRooms(rooms: Set<string>) {
  try {
    window.localStorage.setItem(outOfServiceStorageKey, JSON.stringify([...rooms]));
  } catch {
    // La journée courante reste enregistrée même si ce stockage est indisponible.
  }
}

function readPermanentHotelSettings() {
  try {
    const raw = window.localStorage.getItem(permanentSettingsStorageKey);
    return raw ? JSON.parse(raw) as PermanentHotelSettings : null;
  } catch {
    return null;
  }
}

function writePermanentHotelSettings(settings: PermanentHotelSettings) {
  try {
    window.localStorage.setItem(permanentSettingsStorageKey, JSON.stringify(settings));
  } catch {
    // La copie Supabase reste la source permanente lorsque le stockage local est indisponible.
  }
}

const roomDefinitions: Array<[string, string, string]> = [
  ["101", "PANORAMIQUE", "DBL"], ["102", "DELUXE", "DBL"], ["103", "DELUXE", "DBL"], ["104", "CLASSIQUE", "DBL"],
  ["105A", "DELUXE", "DBL"], ["105B", "DELUXE", "TWIN"], ["106", "CLASSIQUE", "DBL"], ["107", "DELUXE", "TWIN"],
  ["108", "DELUXE", "TWIN"], ["109", "SUP", "DBL"], ["110", "SUP", "DBL"], ["111A", "SUP", "DBL"],
  ["111B", "SUP", "DBL"], ["112", "SUP", "TWIN"], ["114", "SUP", "TPL TWIN"], ["115", "SUP", "TPL TWIN"],
  ["116", "SUP", "TPL TWIN"], ["117", "CLASSIQUE", "TPL TWIN"], ["118", "CLASSIQUE", "TPL TWIN"], ["119", "CLASSIQUE", "TWIN"],
  ["120", "CLASSIQUE", "TWIN"], ["121", "CLASSIQUE", "DBL"], ["122", "CLASSIQUE", "DBL"], ["123", "CLASSIQUE", "DBL"],
  ["124", "CLASSIQUE", "DBL"], ["125", "CLASSIQUE", "DBL"], ["126", "CLASSIQUE", "DBL"], ["127", "STANDARD", "DBL"],
  ["128", "STANDARD", "TWIN"], ["129", "STANDARD", "DBL"],
  ["201", "PANORAMIQUE", "DBL"], ["202", "DELUXE", "DBL"], ["203", "DELUXE", "DBL"], ["204", "CLASSIQUE", "DBL"],
  ["205A", "DELUXE", "DBL"], ["205B", "DELUXE", "TWIN"], ["206", "CLASSIQUE", "DBL"], ["207", "DELUXE", "DBL"],
  ["208", "DELUXE", "DBL"], ["209", "SUP", "DBL"], ["210", "SUP", "DBL"], ["211A", "SUP", "DBL"],
  ["211B", "SUP", "DBL"], ["212", "SUP", "TWIN"], ["214", "SUP", "TPL DBL"], ["215", "SUP", "TPL DBL"],
  ["216", "SUP", "TPL DBL"], ["217", "CLASSIQUE", "TPL DBL"], ["218", "CLASSIQUE", "TPL DBL"], ["219", "CLASSIQUE", "TWIN"],
  ["220", "CLASSIQUE", "TWIN"], ["221", "CLASSIQUE", "TWIN"], ["222", "CLASSIQUE", "DBL"], ["223", "CLASSIQUE", "DBL"],
  ["224", "CLASSIQUE", "DBL"], ["225", "CLASSIQUE", "TWIN"], ["226", "STANDARD", "DBL"], ["227", "STANDARD", "DBL"],
  ["228", "STANDARD", "TWIN"], ["229", "STANDARD", "DBL"],
  ["301", "PANORAMIQUE", "DBL"], ["302", "DELUXE", "DBL"], ["303", "DELUXE", "DBL"], ["304", "CLASSIQUE", "DBL"],
  ["305A", "DELUXE", "DBL"], ["305B", "DELUXE", "TWIN"], ["306", "CLASSIQUE", "DBL"], ["307", "DELUXE", "DBL"],
  ["308", "DELUXE", "DBL"], ["309", "SUP", "DBL"], ["310", "SUP", "DBL"], ["311A", "SUP", "DBL"],
  ["311B", "SUP", "DBL"], ["312", "SUP", "DBL"], ["314", "SUP", "TPL DBL"], ["315", "SUP", "TPL DBL"],
  ["316", "SUP", "TPL DBL"], ["317", "CLASSIQUE", "TPL DBL"], ["318", "CLASSIQUE", "TPL DBL"], ["319", "CLASSIQUE", "TWIN"],
  ["320", "CLASSIQUE", "TWIN"], ["321", "CLASSIQUE", "TWIN"], ["322", "CLASSIQUE", "TWIN"], ["323", "CLASSIQUE", "DBL"],
  ["324", "CLASSIQUE", "DBL"], ["325", "CLASSIQUE", "DBL"], ["326", "CLASSIQUE", "DBL"], ["327", "STANDARD", "DBL"],
  ["328", "STANDARD", "TWIN"], ["329", "STANDARD", "DBL"],
];

const initialRooms: Room[] = roomDefinitions.map(([number, category, layout], index) => ({
  id: index + 1,
  number,
  category,
  layout,
  defaultLayout: layout,
  status: "LP",
  intervention: null,
  housekeeper: "",
  progress: "À faire",
  outOfService: false,
  arrivalToday: ["101", "205A", "318"].includes(number),
}));

const initialEmployees: Employee[] = [
  { id: 1, name: "Kseniia", lastName: "", contract: "35 h", start: "09:30", end: "16:00", presenceMinutes: 390, pause: 30, annexTasks: [], active: true, presentToday: true, delivery: "phone" },
  { id: 2, name: "Nawal", lastName: "", contract: "30 h", start: "09:30", end: "16:00", presenceMinutes: 390, pause: 30, annexTasks: [], active: true, presentToday: true, delivery: "phone" },
  { id: 3, name: "Hayat", lastName: "", contract: "39 h", start: "09:30", end: "16:00", presenceMinutes: 390, pause: 30, annexTasks: [], active: true, presentToday: true, delivery: "phone" },
  { id: 4, name: "Liudmila", lastName: "", contract: "30 h", start: "09:30", end: "16:00", presenceMinutes: 390, pause: 30, annexTasks: [], active: true, presentToday: true, delivery: "pdf" },
  { id: 5, name: "Nicole", lastName: "", contract: "30 h", start: "09:30", end: "16:00", presenceMinutes: 390, pause: 30, annexTasks: [], active: true, presentToday: true, delivery: "pdf" },
  { id: 6, name: "Evelin", lastName: "", contract: "Extra", start: "10:00", end: "15:30", presenceMinutes: 330, pause: 30, annexTasks: [], active: true, presentToday: true, delivery: "pdf" },
];

const initialAccounts: UserAccount[] = [
  { id: 1, name: "Guy Latronche", role: "Administrateur", active: true },
  { id: 2, name: "Katerin", role: "Gouvernante", active: true },
  { id: 3, name: "Réception", role: "Réception", active: true },
];

const accountRoles: AccountRole[] = [
  "Administrateur",
  "Adjoint(e) de direction",
  "Gouvernante",
  "Chef de réception",
  "Réception",
  "Responsable technique",
];

const initialPredefinedInstructions = ["Lit bébé", "Lits séparés", "Arrivée prioritaire", "Canapé-lit", "Anniversaire"];

const initialCommonAreas: CommonArea[] = [
  "Couloir Deluxe — 1er étage",
  "Couloir Triple — 1er étage",
  "Couloir Rue — 1er étage",
  "Couloir Deluxe — 2e étage",
  "Couloir Triple — 2e étage",
  "Couloir Rue — 2e étage",
  "Couloir Deluxe — 3e étage",
  "Couloir Triple — 3e étage",
  "Couloir Rue — 3e étage",
  "Escalier principal",
  "Escalier de secours",
  "Ascenseurs",
  "Hall",
  "Espaces personnel",
  "Toilettes clients",
  "Cour d’accueil",
  "Jardin",
  "Bar extérieur",
  "Restaurant — Salle 1",
  "Restaurant — Salle 2",
  "Restaurant — Salle 3",
  "Restaurant — Salle 4",
  "Cuisine",
  "Locaux techniques et chaufferie",
  "Lingerie",
  "Local poubelles",
  "Terrasses",
  "Façades",
  "Toiture",
  "TGBT 1",
  "TGBT 2",
  "Réseau informatique",
  "Vidéosurveillance",
  "Téléphonie",
].map((name, index) => ({ id: `common-${index + 1}`, name, completed: false }));

const technicalSteps: Array<{ value: TechnicalStatus; label: string }> = [
  { value: "Détecté", label: "Détecté" },
  { value: "Signalé", label: "Signalé au technicien" },
  { value: "En cours", label: "En cours" },
  { value: "Réparé", label: "Réparé" },
];

const workflowForTechnicalStatus: Record<TechnicalStatus, CloudTechnicalWorkflow> = {
  "Détecté": "detected",
  "Signalé": "reported",
  "En cours": "in_progress",
  "Réparé": "repaired",
};

const technicalStatusForWorkflow: Record<CloudTechnicalWorkflow, TechnicalStatus> = {
  detected: "Détecté",
  reported: "Signalé",
  in_progress: "En cours",
  repaired: "Réparé",
  cancelled: "Réparé",
};

const technicalWorkflowLabels: Record<CloudTechnicalWorkflow, string> = {
  detected: "Détecté",
  reported: "Signalé au technicien",
  in_progress: "En cours",
  repaired: "Réparé",
  cancelled: "Signalement annulé",
};

function technicalIncidentIsOpen(incident: CloudTechnicalIncident) {
  return !["repaired", "cancelled"].includes(incident.workflowStatus);
}

const statusLabels: Record<RoomStatus, string> = {
  OP: "Occupée propre",
  OS: "Occupée sale",
  LP: "Libre propre",
  LS: "Libre sale",
};

const navItems = [
  { id: "dashboard" as const, label: "Tableau du jour", icon: LayoutDashboard },
  { id: "distribution" as const, label: "Distribution", icon: BedDouble },
  { id: "personnel" as const, label: "Personnel", icon: UsersRound },
  { id: "reports" as const, label: "Rapports", icon: BarChart3 },
];

function minutesToHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${String(rest).padStart(2, "0")}`;
}

function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
}

function housekeeperSituation(room: Room) {
  if (room.intervention === "À blanc") return room.departureState ?? "Présent";
  return "";
}

function employeeFullName(employee: Employee) {
  return [employee.name, employee.lastName].filter(Boolean).join(" ");
}

function employeeCommonAreaTasks(employee: Employee, commonAreas: CommonArea[]) {
  return commonAreas.filter((area) => area.active !== false && area.action === "Ménage" && area.assignee === employee.name);
}

function employeeAnnexMinutes(employee: Employee, commonAreas: CommonArea[] = []) {
  const annexMinutes = employee.annexTasks.reduce((total, task) => total + task.minutes, 0);
  const commonMinutes = employeeCommonAreaTasks(employee, commonAreas)
    .reduce((total, area) => total + (area.minutes ?? 0), 0);
  return annexMinutes + commonMinutes;
}

function employeeAnnexSummary(employee: Employee, commonAreas: CommonArea[] = []) {
  const tasks = [
    ...employee.annexTasks
      .filter((task) => task.label.trim() || task.minutes)
      .map((task) => `${task.label.trim() || "Tâche sans nom"} (${task.minutes} min)`),
    ...employeeCommonAreaTasks(employee, commonAreas)
      .map((area) => `${area.name}${area.comment?.trim() ? ` · ${area.comment.trim()}` : ""} (${area.minutes ?? 0} min)`),
  ];
  return tasks.length
    ? tasks.join(" · ")
    : "Aucune tâche";
}

function accountInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function layoutChangeInstruction(room: Room) {
  return room.layout === room.defaultLayout ? "" : `Changement de disposition ${room.defaultLayout}->${room.layout}`;
}

function housekeeperInstruction(room: Room) {
  return [layoutChangeInstruction(room), room.receptionComment?.trim()].filter(Boolean).join(" · ");
}

function roomEventLabel(room: Room) {
  if (room.technicalStatus === "Réparé" && room.alert !== "Problème technique") return "Problème technique · Réparé";
  return room.alert ?? "Événement";
}

function availableLayouts(room: Room) {
  return room.defaultLayout.startsWith("TPL") ? ["TPL DBL", "TPL TWIN"] : ["DBL", "TWIN"];
}

function roomStatusForIntervention(intervention: DayIntervention, departureState?: DepartureState): RoomStatus {
  if (intervention === "Recouche") return "OS";
  if (intervention === "Libre") return "LP";
  return departureState === "Parti" ? "LS" : "OS";
}

function roomWithIntervention(room: Room, intervention: DayIntervention): Room {
  const departureState = intervention === "À blanc" ? (room.departureState ?? "Présent") : undefined;
  return {
    ...room,
    intervention,
    status: roomStatusForIntervention(intervention, departureState),
    departureState,
    housekeeper: intervention === "Libre" ? "" : room.housekeeper,
    progress: "À faire",
  };
}

async function imageAsDataUrl(path: string) {
  if (path.startsWith("data:")) return path;
  const blob = await fetch(path).then((response) => response.blob());
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function imageFormat(dataUrl: string) {
  return dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg") ? "JPEG" : "PNG";
}

export default function Home() {
  const cloudClient = useMemo(() => getCloudClient(), []);
  const [page, setPage] = useState<PageId>("dashboard");
  const [dashboardView, setDashboardView] = useState<DashboardView>("rooms");
  const [workDate, setWorkDate] = useState(todayIsoDate);
  const [clock, setClock] = useState(() => new Date());
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [commonAreas, setCommonAreas] = useState<CommonArea[]>(initialCommonAreas);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [accounts, setAccounts] = useState<UserAccount[]>(initialAccounts);
  const [currentAccountId, setCurrentAccountId] = useState(2);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [blankMinutes, setBlankMinutes] = useState(20);
  const [stayoverMinutes, setStayoverMinutes] = useState(15);
  const [defaultPauseMinutes, setDefaultPauseMinutes] = useState(30);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({ equity: true, floors: true, overrun: true });
  const [hotelName, setHotelName] = useState("Hôtel Les Chevaliers");
  const [groupName, setGroupName] = useState("Sowell Hôtels");
  const [hotelAddress, setHotelAddress] = useState("2 rue des Calquières, 11000 Carcassonne");
  const [hotelLogo, setHotelLogo] = useState("/hotel-les-chevaliers.png");
  const [groupLogo, setGroupLogo] = useState("/sowell-hotels.png");
  const [distributionStep, setDistributionStep] = useState<DistributionStep>("team");
  const [distributionInterventionFilter, setDistributionInterventionFilter] = useState<DistributionInterventionFilter>("all");
  const [distributionAssigneeFilter, setDistributionAssigneeFilter] = useState<DistributionAssigneeFilter>("all");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [commonAreaDraft, setCommonAreaDraft] = useState<CommonArea | null>(null);
  const [commonAreaErrors, setCommonAreaErrors] = useState<CommonAreaErrors>({});
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [dashboardSelectedRooms, setDashboardSelectedRooms] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState("Kseniia");
  const [phoneEmployee, setPhoneEmployee] = useState("Kseniia");
  const [showPhone, setShowPhone] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [roomSettingsDraft, setRoomSettingsDraft] = useState<Room[]>([]);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [personnelView, setPersonnelView] = useState<PersonnelView>("active");
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [reportComment, setReportComment] = useState("");
  const [reportCommentError, setReportCommentError] = useState(false);
  const [predefinedInstructions, setPredefinedInstructions] = useState(initialPredefinedInstructions);
  const [newPredefinedInstruction, setNewPredefinedInstruction] = useState("");
  const [newCommonAreaName, setNewCommonAreaName] = useState("");
  const [newEmployee, setNewEmployee] = useState({ name: "", lastName: "", contract: "30 h", start: "09:30", end: "16:00", pause: defaultPauseMinutes, delivery: "pdf" as DeliveryMethod });
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountEmail, setNewAccountEmail] = useState("");
  const [newAccountRole, setNewAccountRole] = useState<AccountRole>("Réception");
  const [adminPassword, setAdminPassword] = useState("admin");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminLoginPassword, setAdminLoginPassword] = useState("");
  const [adminLoginError, setAdminLoginError] = useState(false);
  const [pendingAdminAccountId, setPendingAdminAccountId] = useState<number | null>(null);
  const [openSettingsAfterLogin, setOpenSettingsAfterLogin] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudClient ? "loading" : "local");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [cloudContext, setCloudContext] = useState<CloudContext | null>(null);
  const [authReady, setAuthReady] = useState(!cloudClient);
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [cloudContextError, setCloudContextError] = useState<string | null>(null);
  const [cloudSettingsReady, setCloudSettingsReady] = useState(!cloudClient);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot" | "recovery">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [technicalIncidents, setTechnicalIncidents] = useState<CloudTechnicalIncident[]>([]);
  const [technicalActivity, setTechnicalActivity] = useState<CloudTechnicalActivity[]>([]);
  const [technicalPhotoUrls, setTechnicalPhotoUrls] = useState<Record<number, string>>({});
  const [pendingRoomPhotos, setPendingRoomPhotos] = useState<Record<string, File>>({});
  const [pendingCommonAreaPhoto, setPendingCommonAreaPhoto] = useState<File | null>(null);
  const [technicalBusy, setTechnicalBusy] = useState(false);
  const [technicalSyncError, setTechnicalSyncError] = useState<string | null>(null);
  const skipNextCloudSave = useRef(false);
  const skipNextCloudSettingsSave = useRef(false);
  const latestRemoteUpdatedAt = useRef("");
  const latestSettingsRemoteUpdatedAt = useRef("");
  const deviceId = useRef("");

  const currentRoom = rooms.find((room) => room.number === selectedRoom) ?? null;
  const incidentForLocation = (locationType: "room" | "common_area", location: string) =>
    technicalIncidents.find((incident) =>
      incident.locationType === locationType
      && incident.location === location
      && (technicalIncidentIsOpen(incident) || incident.reportedForDate === workDate)
    ) ?? null;
  const currentRoomIncident = currentRoom ? incidentForLocation("room", currentRoom.number) : null;
  const currentRoomTechnicalStatus = currentRoomIncident
    ? technicalStatusForWorkflow[currentRoomIncident.workflowStatus]
    : currentRoom?.technicalStatus ?? "Détecté";
  const currentRoomPhoto = currentRoomIncident?.photoKey
    ? technicalPhotoUrls[currentRoomIncident.id]
    : currentRoom?.technicalPhotoData;
  const currentCommonAreaIncident = commonAreaDraft
    ? incidentForLocation("common_area", commonAreaDraft.name)
    : null;
  const currentCommonAreaTechnicalStatus = currentCommonAreaIncident
    ? technicalStatusForWorkflow[currentCommonAreaIncident.workflowStatus]
    : commonAreaDraft?.technicalStatus ?? "Détecté";
  const currentCommonAreaPhoto = currentCommonAreaIncident?.photoKey
    ? technicalPhotoUrls[currentCommonAreaIncident.id]
    : commonAreaDraft?.technicalPhotoData;
  const activityForIncident = (incidentId: number | undefined) => incidentId
    ? technicalActivity.filter((entry) => entry.interventionId === incidentId)
    : [];
  const roomPhotoSource = (room: Room) => {
    const incident = incidentForLocation("room", room.number);
    return incident?.photoKey ? technicalPhotoUrls[incident.id] : room.technicalPhotoData;
  };
  const currentAccount = cloudContext
    ? accounts.find((account) => account.email?.toLocaleLowerCase("fr") === cloudContext.email.toLocaleLowerCase("fr"))
      ?? { id: -1, name: cloudContext.displayName, email: cloudContext.email, role: cloudContext.role as AccountRole, active: true }
    : accounts.find((account) => account.id === currentAccountId) ?? accounts[0];
  const canManageSettings = currentAccount.role === "Administrateur" && (Boolean(cloudContext) || adminUnlocked);
  const appSnapshot = useMemo<AppSnapshot>(() => ({
    schemaVersion: SNAPSHOT_VERSION,
    workDate,
    rooms,
    commonAreas,
    employees,
    accounts,
    blankMinutes,
    stayoverMinutes,
    defaultPauseMinutes,
    alertSettings,
    hotelName,
    groupName,
    hotelAddress,
    hotelLogo,
    groupLogo,
    predefinedInstructions,
    reportComment,
    savedAt: new Date().toISOString(),
  }), [
    accounts,
    alertSettings,
    blankMinutes,
    commonAreas,
    defaultPauseMinutes,
    employees,
    groupLogo,
    groupName,
    hotelAddress,
    hotelLogo,
    hotelName,
    predefinedInstructions,
    reportComment,
    rooms,
    stayoverMinutes,
    workDate,
  ]);

  const applySnapshot = (snapshot: Partial<AppSnapshot>) => {
    if (snapshot.schemaVersion !== SNAPSHOT_VERSION) return;
    if (Array.isArray(snapshot.rooms)) setRooms(snapshot.rooms);
    if (Array.isArray(snapshot.commonAreas)) setCommonAreas(snapshot.commonAreas);
    if (Array.isArray(snapshot.employees)) setEmployees(snapshot.employees);
    if (Array.isArray(snapshot.accounts) && !cloudContext) setAccounts(snapshot.accounts);
    if (typeof snapshot.blankMinutes === "number") setBlankMinutes(snapshot.blankMinutes);
    if (typeof snapshot.stayoverMinutes === "number") setStayoverMinutes(snapshot.stayoverMinutes);
    if (typeof snapshot.defaultPauseMinutes === "number") setDefaultPauseMinutes(snapshot.defaultPauseMinutes);
    if (snapshot.alertSettings) setAlertSettings(snapshot.alertSettings);
    if (typeof snapshot.hotelName === "string") setHotelName(snapshot.hotelName);
    if (typeof snapshot.groupName === "string") setGroupName(snapshot.groupName);
    if (typeof snapshot.hotelAddress === "string") setHotelAddress(snapshot.hotelAddress);
    if (typeof snapshot.hotelLogo === "string") setHotelLogo(snapshot.hotelLogo);
    if (typeof snapshot.groupLogo === "string") setGroupLogo(snapshot.groupLogo);
    if (Array.isArray(snapshot.predefinedInstructions)) setPredefinedInstructions(snapshot.predefinedInstructions);
    if (typeof snapshot.reportComment === "string") setReportComment(snapshot.reportComment);
  };

  const freshSnapshotForDate = (date: string, directory = readEmployeeDirectory() ?? employees): AppSnapshot => ({
    ...appSnapshot,
    workDate: date,
    rooms: rooms.map((room) => ({
      ...room,
      intervention: null,
      departureState: undefined,
      housekeeper: "",
      progress: "À faire",
      arrivalToday: false,
      alert: room.alert === "Problème technique" && room.technicalStatus !== "Réparé" ? room.alert : undefined,
      technicalStatus: room.alert === "Problème technique" && room.technicalStatus !== "Réparé" ? room.technicalStatus : undefined,
      technicalIncidentId: room.alert === "Problème technique" && room.technicalStatus !== "Réparé" ? room.technicalIncidentId : undefined,
      technicalPhotoKey: room.alert === "Problème technique" && room.technicalStatus !== "Réparé" ? room.technicalPhotoKey : undefined,
      technicalPhotoName: room.alert === "Problème technique" && room.technicalStatus !== "Réparé" ? room.technicalPhotoName : undefined,
      technicalPhotoData: room.alert === "Problème technique" && room.technicalStatus !== "Réparé" ? room.technicalPhotoData : undefined,
      receptionComment: undefined,
      floorComment: undefined,
      status: room.outOfService ? room.status : "LP",
    })),
    commonAreas: commonAreas.map((area) => ({
      ...area,
      completed: false,
      action: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.action : undefined,
      comment: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.comment : "",
      assignee: "",
      minutes: 0,
      technicalStatus: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.technicalStatus : undefined,
      technicalIncidentId: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.technicalIncidentId : undefined,
      technicalPhotoKey: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.technicalPhotoKey : undefined,
      technicalPhotoName: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.technicalPhotoName : undefined,
      technicalPhotoData: area.action === "Problème technique" && area.technicalStatus !== "Réparé" ? area.technicalPhotoData : undefined,
    })),
    employees: directory.map((employee) => ({
      ...employeeDirectoryRecord(employee),
      presentToday: false,
      annexTasks: [],
    })),
    reportComment: "",
    savedAt: new Date().toISOString(),
  });
  const prepStats = useMemo(() => {
    const blanks = rooms.filter((room) => room.intervention === "À blanc").length;
    const stayovers = rooms.filter((room) => room.intervention === "Recouche").length;
    const free = rooms.filter((room) => room.intervention === "Libre").length;
    const outOfService = rooms.filter((room) => room.outOfService).length;
    const unclassified = rooms.length - blanks - stayovers - free;
    const remainingToControl = rooms.filter((room) =>
      (room.intervention === "À blanc" || room.intervention === "Recouche")
      && room.progress !== "Contrôlée"
      && room.progress !== "Validée sans contrôle"
    ).length;
    return {
      blanks,
      stayovers,
      free,
      outOfService,
      unclassified,
      remainingToControl,
      serviceRooms: blanks + stayovers,
      workloadMinutes: blanks * blankMinutes + stayovers * stayoverMinutes,
    };
  }, [blankMinutes, rooms, stayoverMinutes]);
  const presentEmployees = useMemo(() => employees.filter((employee) => employee.active && employee.presentToday), [employees]);
  const totalAvailableMinutes = useMemo(
    () => presentEmployees.reduce((total, employee) => total + Math.max(0, employee.presenceMinutes - employee.pause - employeeAnnexMinutes(employee, commonAreas)), 0),
    [commonAreas, presentEmployees],
  );
  const averageRoomMinutes = prepStats.serviceRooms ? prepStats.workloadMinutes / prepStats.serviceRooms : 17.5;
  const reportRows = useMemo(() => employees.filter((employee) => employee.active && employee.presentToday).map((employee) => {
    const employeeRooms = rooms.filter((room) => room.housekeeper === employee.name && room.intervention !== "Libre" && room.intervention !== null);
    const blanks = employeeRooms.filter((room) => room.intervention === "À blanc").length;
    const stayovers = employeeRooms.filter((room) => room.intervention === "Recouche").length;
    const roomCount = blanks + stayovers;
    const theoretical = blanks * blankMinutes + stayovers * stayoverMinutes;
    const annexMinutes = employeeAnnexMinutes(employee, commonAreas);
    const netDay = Math.max(0, employee.presenceMinutes - employee.pause);
    const available = Math.max(0, netDay - annexMinutes);
    const totalCharge = theoretical + annexMinutes;
    return {
      name: employeeFullName(employee),
      blanks,
      stayovers,
      rooms: roomCount,
      presence: employee.presenceMinutes,
      pause: employee.pause,
      annex: employeeAnnexSummary(employee, commonAreas),
      annexMinutes,
      theoretical,
      totalCharge,
      netDay,
      available,
      cadence: available ? roomCount / (available / 60) : 0,
      load: netDay ? (totalCharge / netDay) * 100 : 0,
    };
  }), [blankMinutes, commonAreas, employees, rooms, stayoverMinutes]);
  const dayEvents = useMemo(() => rooms.filter((room) => Boolean(room.alert) || room.technicalStatus === "Réparé"), [rooms]);

  const assignmentStats = useMemo(() => presentEmployees.map((employee) => {
    const assignedRooms = rooms.filter((room) => room.housekeeper === employee.name && (room.intervention === "À blanc" || room.intervention === "Recouche"));
    const roomWorkload = assignedRooms.reduce((total, room) => total + (room.intervention === "À blanc" ? blankMinutes : stayoverMinutes), 0);
    const annexWorkload = employeeAnnexMinutes(employee, commonAreas);
    const workload = roomWorkload + annexWorkload;
    const available = Math.max(0, employee.presenceMinutes - employee.pause);
    const floors = Array.from(new Set(assignedRooms.map((room) => room.number.charAt(0)).filter(Boolean))).sort();
    return {
      employee,
      assignedRooms,
      roomWorkload,
      annexWorkload,
      workload,
      available,
      floors,
      loadRate: available ? workload / available : 0,
    };
  }), [blankMinutes, commonAreas, presentEmployees, rooms, stayoverMinutes]);

  const distributionAlerts = useMemo<DistributionAlert[]>(() => {
    const alerts: DistributionAlert[] = [];
    const threeFloorEmployees = assignmentStats.filter((stat) => stat.floors.length >= 3);
    if (alertSettings.floors) {
      threeFloorEmployees.forEach((stat) => {
        alerts.push({
          id: `floors-${stat.employee.id}`,
          kind: "floors",
          title: `Alerte 3 étages · ${employeeFullName(stat.employee)}`,
          detail: `${stat.assignedRooms.length} chambres réparties sur les étages ${stat.floors.join(", ")}. Il vaut mieux regrouper sa feuille.`,
          employeeNames: [stat.employee.name],
        });
      });
    }

    const comparable = assignmentStats.filter((stat) => stat.available > 0);
    const assignedCount = comparable.reduce((total, stat) => total + stat.assignedRooms.length, 0);
    const enoughAssigned = assignedCount >= Math.min(prepStats.serviceRooms, Math.max(6, comparable.length * 2));
    if (alertSettings.equity && comparable.length >= 2 && enoughAssigned) {
      const sortedByRate = [...comparable].sort((a, b) => a.loadRate - b.loadRate);
      const lowest = sortedByRate[0];
      const highest = sortedByRate[sortedByRate.length - 1];
      const rateGap = highest.loadRate - lowest.loadRate;
      const workloadGap = Math.abs(highest.workload - lowest.workload);
      if (rateGap >= 0.18 && workloadGap >= 45) {
        alerts.push({
          id: "equity-workload",
          kind: "equity",
          title: "Alerte équité · charge manifestement déséquilibrée",
          detail: `${employeeFullName(highest.employee)} utilise ${Math.round(highest.loadRate * 100)} % de son temps net contre ${Math.round(lowest.loadRate * 100)} % pour ${employeeFullName(lowest.employee)} (${workloadGap} min d’écart, tâches annexes comprises).`,
          employeeNames: [highest.employee.name, lowest.employee.name],
        });
      }
    }

    if (alertSettings.equity && alertSettings.floors && threeFloorEmployees.length && !alerts.some((alert) => alert.kind === "equity")) {
      alerts.push({
        id: "equity-floors",
        kind: "equity",
        title: "Alerte équité · dispersion sur 3 étages",
        detail: "Une feuille répartie sur trois étages crée des déplacements supplémentaires qui faussent l’équilibre réel de la distribution.",
        employeeNames: threeFloorEmployees.map((stat) => stat.employee.name),
      });
    }

    if (alertSettings.overrun) {
      assignmentStats.filter((stat) => stat.workload > stat.available).forEach((stat) => {
        const overrun = stat.workload - stat.available;
        alerts.push({
          id: `overrun-${stat.employee.id}`,
          kind: "overrun",
          title: `Alerte dépassement · ${employeeFullName(stat.employee)}`,
          detail: `${minutesToHours(stat.workload)} de travail prévisionnel pour ${minutesToHours(stat.available)} de temps contractuel net aujourd’hui, pause de ${stat.employee.pause} min déduite (${overrun} min de dépassement).`,
          employeeNames: [stat.employee.name],
        });
      });
    }
    return alerts;
  }, [alertSettings, assignmentStats, prepStats.serviceRooms]);

  const categoryCounts = useMemo(() => rooms.reduce<Record<string, number>>((counts, room) => {
    counts[room.category] = (counts[room.category] ?? 0) + 1;
    return counts;
  }, {}), [rooms]);

  const layoutCounts = useMemo(() => rooms.reduce<Record<string, number>>((counts, room) => {
    counts[room.defaultLayout] = (counts[room.defaultLayout] ?? 0) + 1;
    return counts;
  }, {}), [rooms]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    try {
      const stored = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}:device-id`);
      deviceId.current = stored || window.crypto.randomUUID();
      if (!stored) window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}:device-id`, deviceId.current);
    } catch {
      deviceId.current = `device-${Date.now()}`;
    }
    const handleOnline = () => setSyncStatus(cloudClient ? "saving" : "local");
    const handleOffline = () => setSyncStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [cloudClient]);

  useEffect(() => {
    if (!cloudClient) return;
    let active = true;
    cloudClient.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuthUserEmail(data.session?.user.email ?? null);
      setAuthReady(true);
    });
    const { data: subscription } = cloudClient.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("recovery");
        setAuthPassword("");
        setAuthError(null);
      }
      setAuthUserEmail(session?.user.email ?? null);
      if (!session) {
        setCloudContext(null);
        setCloudSettingsReady(false);
        setHydrated(false);
        setTechnicalIncidents([]);
        setTechnicalActivity([]);
        setTechnicalPhotoUrls({});
      }
      setAuthReady(true);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [cloudClient]);

  useEffect(() => {
    if (!cloudClient || !authUserEmail) return;
    let active = true;
    const loadContext = async () => {
      await Promise.resolve();
      if (!active) return;
      setCloudContextError(null);
      setSyncStatus("loading");
      try {
        const context = await resolveCloudContext(cloudClient, hotelName);
        if (!active) return;
        setCloudContext(context);
        const members = await listCloudMembers(cloudClient, context.hotelId);
        if (!active) return;
        const mappedAccounts = members.map((member, index) => ({
          id: index + 1,
          membershipId: member.id,
          userId: member.user_id,
          name: member.display_name,
          email: member.email,
          role: member.role as AccountRole,
          active: member.active,
        }));
        setAccounts(mappedAccounts);
        const signedIn = mappedAccounts.find((account) => account.email?.toLowerCase() === context.email.toLowerCase());
        if (signedIn) setCurrentAccountId(signedIn.id);
      } catch (error: unknown) {
        if (!active) return;
        setCloudContext(null);
        setCloudContextError(error instanceof Error ? error.message : "Impossible d’ouvrir cet hôtel.");
        setSyncStatus("error");
      }
    };
    void loadContext();
    return () => {
      active = false;
    };
  }, [authUserEmail, cloudClient, hotelName]);

  useEffect(() => {
    if (!cloudClient || !cloudContext) return;
    let active = true;
    Promise.all([
      listCloudTechnicalIncidents(cloudClient, cloudContext.hotelId),
      listCloudTechnicalActivity(cloudClient, cloudContext.hotelId),
    ]).then(([incidents, history]) => {
      if (!active) return;
      setTechnicalIncidents(incidents);
      setTechnicalActivity(history);
      setTechnicalSyncError(null);
    }).catch((error: unknown) => {
      if (!active) return;
      setTechnicalSyncError(error instanceof Error ? error.message : "Impossible de charger les signalements techniques.");
    });
    return () => {
      active = false;
    };
  }, [cloudClient, cloudContext]);

  useEffect(() => {
    if (!cloudClient || !cloudContext) return;
    let active = true;
    let refreshRunning = false;
    let refreshQueued = false;
    let reconnectTimer: number | null = null;

    const refreshTechnicalData = async () => {
      if (!active) return;
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }
      refreshRunning = true;
      try {
        const [incidents, history] = await Promise.all([
          listCloudTechnicalIncidents(cloudClient, cloudContext.hotelId),
          listCloudTechnicalActivity(cloudClient, cloudContext.hotelId),
        ]);
        if (!active) return;
        setTechnicalIncidents(incidents);
        setTechnicalActivity(history);
        setTechnicalSyncError(null);
      } catch (error: unknown) {
        if (!active) return;
        setTechnicalSyncError(error instanceof Error ? error.message : "Synchronisation technique indisponible.");
      } finally {
        refreshRunning = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void refreshTechnicalData();
        }
      }
    };

    const reconnectAndRefresh = () => {
      if (!active) return;
      if (!cloudClient.realtime.isConnected()) cloudClient.realtime.connect();
      void refreshTechnicalData();
    };

    const handleResume = () => {
      if (document.visibilityState === "visible") reconnectAndRefresh();
    };

    const channel = cloudClient
      .channel(`raccotel-technique-${cloudContext.hotelId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "raccotel_technique_interventions",
        filter: `hotel_id=eq.${cloudContext.hotelId}`,
      }, () => void refreshTechnicalData())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "raccotel_technique_activity",
        filter: `hotel_id=eq.${cloudContext.hotelId}`,
      }, () => void refreshTechnicalData())
      .subscribe((status, error) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          void refreshTechnicalData();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setTechnicalSyncError(error?.message || "Reconnexion automatique au suivi Technique…");
          if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(reconnectAndRefresh, 1_500);
        }
      });

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", reconnectAndRefresh);
    window.addEventListener("online", reconnectAndRefresh);
    const safetyRefresh = window.setInterval(() => {
      if (document.visibilityState === "visible") reconnectAndRefresh();
    }, 45_000);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", reconnectAndRefresh);
      window.removeEventListener("online", reconnectAndRefresh);
      window.clearInterval(safetyRefresh);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      cloudClient.removeChannel(channel);
    };
  }, [cloudClient, cloudContext]);

  useEffect(() => {
    if (!cloudClient) return;
    let active = true;
    const withPhotos = technicalIncidents.filter((incident) => incident.photoKey);
    Promise.all(withPhotos.map(async (incident) => {
      try {
        return [incident.id, await getCloudTechnicalPhotoUrl(cloudClient, incident.photoKey!)] as const;
      } catch {
        return [incident.id, ""] as const;
      }
    })).then((entries) => {
      if (!active) return;
      setTechnicalPhotoUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
    });
    return () => {
      active = false;
    };
  }, [cloudClient, technicalIncidents]);

  useEffect(() => {
    if (!technicalIncidents.length) return;
    const visibleIncidents = technicalIncidents.filter((incident) =>
      technicalIncidentIsOpen(incident) || incident.reportedForDate === workDate
    );
    const timer = window.setTimeout(() => {
      setRooms((current) => current.map((room) => {
        const incident = visibleIncidents.find((entry) => entry.locationType === "room" && entry.location === room.number);
        if (!incident) return room;
        const closed = ["repaired", "cancelled"].includes(incident.workflowStatus);
        return {
          ...room,
          alert: closed ? undefined : "Problème technique",
          technicalStatus: technicalStatusForWorkflow[incident.workflowStatus],
          technicalIncidentId: incident.id,
          technicalPhotoKey: incident.photoKey || undefined,
          technicalPhotoName: incident.photoName || undefined,
          floorComment: room.floorComment?.trim() ? room.floorComment : incident.description || undefined,
        };
      }));
      setCommonAreas((current) => current.map((area) => {
        const incident = visibleIncidents.find((entry) => entry.locationType === "common_area" && entry.location === area.name);
        if (!incident) return area;
        const cancelled = incident.workflowStatus === "cancelled";
        return {
          ...area,
          action: cancelled ? undefined : "Problème technique",
          comment: area.comment?.trim() ? area.comment : incident.description,
          technicalStatus: technicalStatusForWorkflow[incident.workflowStatus],
          technicalIncidentId: incident.id,
          technicalPhotoKey: incident.photoKey || undefined,
          technicalPhotoName: incident.photoName || undefined,
        };
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, technicalIncidents, workDate]);

  useEffect(() => {
    if (cloudClient && !cloudContext) return;
    let active = true;

    const loadDay = async () => {
      await Promise.resolve();
      if (!active) return;
      setHydrated(false);
      setCloudSettingsReady(!cloudClient);
      setSyncStatus(cloudClient ? "loading" : navigator.onLine ? "local" : "offline");
      let localSnapshot: AppSnapshot | null = null;
      const localDirectory = readEmployeeDirectory() ?? employees.map(employeeDirectoryRecord);
      try {
        const raw = window.localStorage.getItem(dayStorageKey(workDate));
        localSnapshot = raw ? JSON.parse(raw) as AppSnapshot : null;
      } catch {
        localSnapshot = null;
      }

      let selectedSnapshot = localSnapshot?.schemaVersion === SNAPSHOT_VERSION
        ? localSnapshot
        : freshSnapshotForDate(workDate, localDirectory);

      let cloudPermanent: Partial<PermanentCloudSnapshot> | null = null;

      if (cloudClient && cloudContext) {
        const { data, error } = await cloudClient
          .from("raccoon_days")
          .select("payload,updated_at")
          .eq("hotel_id", cloudContext.hotelId)
          .eq("work_date", workDate)
          .maybeSingle();
        if (error) {
          if (!active) return;
          setSyncStatus(navigator.onLine ? "error" : "offline");
        } else if (data?.payload) {
          selectedSnapshot = data.payload as AppSnapshot;
          latestRemoteUpdatedAt.current = String(data.updated_at ?? "");
          skipNextCloudSave.current = true;
          setSyncStatus("synced");
        }

        const { data: settingsData, error: settingsError } = await cloudClient
          .from("raccoon_settings")
          .select("payload,updated_at")
          .eq("hotel_id", cloudContext.hotelId)
          .maybeSingle();
        if (settingsError) {
          if (!active) return;
          setSyncStatus(navigator.onLine ? "error" : "offline");
        } else if (settingsData?.payload) {
          cloudPermanent = settingsData.payload as Partial<PermanentCloudSnapshot>;
          latestSettingsRemoteUpdatedAt.current = String(settingsData.updated_at ?? "");
          skipNextCloudSettingsSave.current = true;
        }
      }

      const directory = Array.isArray(cloudPermanent?.employees)
        ? cloudPermanent.employees.map(employeeDirectoryRecord)
        : localDirectory;
      const permanentSettings = cloudPermanent
        ? Object.fromEntries(Object.entries(cloudPermanent).filter(([key]) => ![
            "schemaVersion",
            "employees",
            "rooms",
            "outOfServiceRooms",
            "savedAt",
          ].includes(key))) as PermanentHotelSettings
        : readPermanentHotelSettings();
      const persistentOutOfService = Array.isArray(cloudPermanent?.outOfServiceRooms)
        ? new Set(cloudPermanent.outOfServiceRooms)
        : readPersistentOutOfServiceRooms();
      const permanentRooms = Array.isArray(cloudPermanent?.rooms) ? cloudPermanent.rooms : [];

      writeEmployeeDirectory(directory);
      writePersistentOutOfServiceRooms(persistentOutOfService);
      if (permanentSettings) writePermanentHotelSettings(permanentSettings);
      const permanentCommonAreas = Array.isArray(permanentSettings?.commonAreas)
        ? permanentSettings.commonAreas.map(permanentCommonAreaRecord)
        : [];
      const settingsWithoutCommonAreas = permanentSettings
        ? Object.fromEntries(Object.entries(permanentSettings).filter(([key]) => key !== "commonAreas")) as Omit<PermanentHotelSettings, "commonAreas">
        : null;
      selectedSnapshot = {
        ...selectedSnapshot,
        ...(settingsWithoutCommonAreas ?? {}),
        employees: mergeEmployeesWithDirectory(selectedSnapshot.employees ?? [], directory),
        rooms: mergeRoomsWithPermanent(selectedSnapshot.rooms ?? [], permanentRooms, persistentOutOfService),
        commonAreas: mergeCommonAreasWithPermanent(selectedSnapshot.commonAreas ?? [], permanentCommonAreas),
      };

      if (!active) return;
      applySnapshot(selectedSnapshot);
      setLastSavedAt(selectedSnapshot.savedAt ? new Date(selectedSnapshot.savedAt) : null);
      setCloudSettingsReady(true);
      setHydrated(true);
    };

    loadDay().catch(() => {
      if (!active) return;
      setHydrated(true);
      setCloudSettingsReady(!cloudClient);
      setSyncStatus(navigator.onLine ? "error" : "offline");
    });
    return () => {
      active = false;
    };
    // applySnapshot et freshSnapshotForDate utilisent volontairement la configuration
    // courante comme modèle lorsqu’une nouvelle journée est ouverte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudClient, cloudContext, workDate]);

  useEffect(() => {
    if (!hydrated) return;
    const permanentSettings: PermanentHotelSettings = {
      accounts,
      commonAreas: commonAreas.map(permanentCommonAreaRecord),
      blankMinutes,
      stayoverMinutes,
      defaultPauseMinutes,
      alertSettings,
      hotelName,
      groupName,
      hotelAddress,
      hotelLogo,
      groupLogo,
      predefinedInstructions,
    };
    writePermanentHotelSettings(permanentSettings);
  }, [accounts, alertSettings, blankMinutes, commonAreas, defaultPauseMinutes, groupLogo, groupName, hotelAddress, hotelLogo, hotelName, hydrated, predefinedInstructions, stayoverMinutes]);

  useEffect(() => {
    if (!hydrated || !cloudClient || !cloudContext || !cloudSettingsReady) return;
    if (skipNextCloudSettingsSave.current) {
      skipNextCloudSettingsSave.current = false;
      return;
    }

    const directory = readEmployeeDirectory() ?? employees.map(employeeDirectoryRecord);
    const outOfServiceRooms = rooms.filter((room) => room.outOfService).map((room) => room.number);
    const payload: PermanentCloudSnapshot = {
      schemaVersion: 2,
      employees: directory.map(employeeDirectoryRecord),
      rooms: rooms.map(permanentRoomRecord),
      commonAreas: commonAreas.map(permanentCommonAreaRecord),
      outOfServiceRooms,
      accounts,
      blankMinutes,
      stayoverMinutes,
      defaultPauseMinutes,
      alertSettings,
      hotelName,
      groupName,
      hotelAddress,
      hotelLogo,
      groupLogo,
      predefinedInstructions,
      savedAt: new Date().toISOString(),
    };

    const timer = window.setTimeout(async () => {
      const updatedAt = new Date().toISOString();
      const { error } = await cloudClient.from("raccoon_settings").upsert({
        hotel_id: cloudContext.hotelId,
        payload: { ...payload, savedAt: updatedAt },
        updated_at: updatedAt,
        updated_by: cloudContext.userId,
      }, { onConflict: "hotel_id" });
      if (error) {
        setSyncStatus(navigator.onLine ? "error" : "offline");
        return;
      }
      latestSettingsRemoteUpdatedAt.current = updatedAt;
      setSyncStatus("synced");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [accounts, alertSettings, appSnapshot, blankMinutes, cloudClient, cloudContext, cloudSettingsReady, commonAreas, defaultPauseMinutes, employees, groupLogo, groupName, hotelAddress, hotelLogo, hotelName, hydrated, predefinedInstructions, rooms, stayoverMinutes]);

  useEffect(() => {
    if (!hydrated) return;
    const savedAt = new Date();
    const payload = { ...appSnapshot, savedAt: savedAt.toISOString() };
    try {
      window.localStorage.setItem(dayStorageKey(workDate), JSON.stringify(payload));
      window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}:latest-date`, workDate);
      window.queueMicrotask(() => setLastSavedAt(savedAt));
    } catch {
      window.queueMicrotask(() => setSyncStatus("error"));
      return;
    }

    if (!cloudClient || !cloudContext) {
      window.queueMicrotask(() => setSyncStatus(navigator.onLine ? "local" : "offline"));
      return;
    }
    if (skipNextCloudSave.current) {
      skipNextCloudSave.current = false;
      window.queueMicrotask(() => setSyncStatus("synced"));
      return;
    }

    window.queueMicrotask(() => setSyncStatus(navigator.onLine ? "saving" : "offline"));
    const timer = window.setTimeout(async () => {
      const updatedAt = new Date().toISOString();
      const { error } = await cloudClient.from("raccoon_days").upsert({
        hotel_id: cloudContext.hotelId,
        work_date: workDate,
        payload: { ...payload, savedAt: updatedAt },
        updated_at: updatedAt,
        updated_by: cloudContext.userId,
        device_id: deviceId.current,
      }, { onConflict: "hotel_id,work_date" });
      if (error) {
        setSyncStatus(navigator.onLine ? "error" : "offline");
        return;
      }
      latestRemoteUpdatedAt.current = updatedAt;
      setLastSavedAt(new Date(updatedAt));
      setSyncStatus("synced");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [appSnapshot, cloudClient, cloudContext, hydrated, workDate]);

  useEffect(() => {
    if (!cloudClient || !cloudContext || !hydrated) return;
    const channel = cloudClient
      .channel(`raccoon-day-${cloudContext.hotelId}-${workDate}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "raccoon_days",
        filter: `hotel_id=eq.${cloudContext.hotelId}`,
      }, (event) => {
        const next = event.new as Record<string, unknown>;
        if (String(next.work_date ?? "") !== workDate) return;
        if (String(next.device_id ?? "") === deviceId.current) return;
        const remoteUpdatedAt = String(next.updated_at ?? "");
        if (latestRemoteUpdatedAt.current && remoteUpdatedAt <= latestRemoteUpdatedAt.current) return;
        latestRemoteUpdatedAt.current = remoteUpdatedAt;
        skipNextCloudSave.current = true;
        applySnapshot(next.payload as AppSnapshot);
        setLastSavedAt(remoteUpdatedAt ? new Date(remoteUpdatedAt) : new Date());
        setSyncStatus("synced");
      })
      .subscribe();
    return () => {
      cloudClient.removeChannel(channel);
    };
    // applySnapshot est un applicateur d’état stable au niveau fonctionnel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudClient, cloudContext, hydrated, workDate]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const submitCloudAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cloudClient || !authEmail.trim() || authPassword.length < 6 || (authMode !== "login" && authMode !== "signup")) return;
    setAuthBusy(true);
    setAuthError(null);
    const credentials = { email: authEmail.trim().toLowerCase(), password: authPassword };
    const { error } = authMode === "login"
      ? await cloudClient.auth.signInWithPassword(credentials)
      : await cloudClient.auth.signUp({
        ...credentials,
        options: { data: { full_name: authEmail.split("@")[0] } },
      });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    if (authMode === "signup") {
      setAuthError("Compte créé. Si la confirmation e-mail est activée, ouvre le message reçu avant de te connecter.");
      setAuthMode("login");
    }
  };

  const requestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cloudClient || !authEmail.trim()) return;
    setAuthBusy(true);
    setAuthError(null);
    const email = authEmail.trim().toLowerCase();
    const { error } = await cloudClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    let adminNotified = false;
    if (!error) {
      try {
        const response = await fetch("/api/auth/reset-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const notification = await response.json().catch(() => null) as { notified?: boolean } | null;
        adminNotified = response.ok && notification?.notified === true;
      } catch {
        adminNotified = false;
      }
    }
    setAuthBusy(false);
    setAuthError(error
      ? "La demande n’a pas pu être envoyée pour le moment. Réessaie dans quelques minutes."
      : `Si cette adresse correspond à un compte autorisé, le lien de réinitialisation vient d’être envoyé.${adminNotified ? " L’administrateur a aussi été informé." : ""}`);
  };

  const submitRecoveryPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cloudClient || authPassword.length < 6) return;
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await cloudClient.auth.updateUser({ password: authPassword });
    setAuthBusy(false);
    if (error) {
      setAuthError("Le mot de passe n’a pas pu être modifié. Demande un nouveau lien.");
      return;
    }
    await cloudClient.auth.signOut();
    setAuthUserEmail(null);
    setAuthPassword("");
    setAuthMode("login");
    setAuthError("Mot de passe modifié. Tu peux maintenant te connecter.");
  };

  const signOutCloud = async () => {
    if (!cloudClient) return;
    await cloudClient.auth.signOut();
    setCloudContext(null);
    setAuthUserEmail(null);
    setAuthPassword("");
    setPage("dashboard");
  };

  const refreshCloudMembers = async () => {
    if (!cloudClient || !cloudContext) return;
    const members = await listCloudMembers(cloudClient, cloudContext.hotelId);
    setAccounts(members.map((member, index) => ({
      id: index + 1,
      membershipId: member.id,
      userId: member.user_id,
      name: member.display_name,
      email: member.email,
      role: member.role as AccountRole,
      active: member.active,
    })));
  };

  const uploadLogo = (event: ChangeEvent<HTMLInputElement>, setLogo: (value: string) => void) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choisis un fichier image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("L’image doit peser moins de 5 Mo");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(String(reader.result));
      showToast("Logo mis à jour dans toute l’application");
    };
    reader.readAsDataURL(file);
  };

  const updateRoom = (number: string, patch: Partial<Room>) => {
    setRooms((current) => current.map((room) => (room.number === number ? { ...room, ...patch } : room)));
  };

  const setIntervention = (number: string, intervention: DayIntervention) => {
    setRooms((current) => current.map((room) => room.number === number ? roomWithIntervention(room, intervention) : room));
  };

  const updateDepartureState = (room: Room, departureState: DepartureState) => {
    updateRoom(room.number, {
      departureState,
      status: roomStatusForIntervention("À blanc", departureState),
    });
  };

  const rememberTechnicalIncident = (incident: CloudTechnicalIncident) => {
    setTechnicalIncidents((current) => [incident, ...current.filter((entry) => entry.id !== incident.id)]);
  };

  const technicalErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Impossible de synchroniser le signalement avec Technique.";

  const ensureRoomTechnicalIncident = async (room: Room) => {
    if (!cloudClient || !cloudContext) throw new Error("Connexion au socle Raccotel requise.");
    const existing = incidentForLocation("room", room.number);
    if (existing) return existing;
    const description = room.floorComment?.trim() || room.receptionComment?.trim() || "";
    const created = await createCloudTechnicalIncident(cloudClient, cloudContext, {
      workDate,
      location: room.number,
      locationType: "room",
      title: description || "Problème technique",
      description,
    });
    rememberTechnicalIncident(created);
    updateRoom(room.number, { technicalIncidentId: created.id });
    return created;
  };

  const toggleRoomAlert = (room: Room, alert: NonNullable<Room["alert"]>) => {
    const removing = room.alert === alert;
    const currentIncident = incidentForLocation("room", room.number);
    updateRoom(room.number, {
      alert: removing ? undefined : alert,
      technicalStatus: !removing && alert === "Problème technique" ? "Détecté" : undefined,
      technicalIncidentId: !removing && alert === "Problème technique" ? room.technicalIncidentId : undefined,
      technicalPhotoKey: !removing && alert === "Problème technique" ? room.technicalPhotoKey : undefined,
      technicalPhotoName: !removing && alert === "Problème technique" ? room.technicalPhotoName : undefined,
      technicalPhotoData: !removing && alert === "Problème technique" ? room.technicalPhotoData : undefined,
    });

    const mustCloseTechnicalIncident = currentIncident
      && technicalIncidentIsOpen(currentIncident)
      && (removing || alert !== "Problème technique");
    if (mustCloseTechnicalIncident && cloudClient && cloudContext) {
      setTechnicalBusy(true);
      void updateCloudTechnicalIncident(cloudClient, cloudContext, currentIncident.id, {
        workflowStatus: "cancelled",
      }).then((updated) => {
        rememberTechnicalIncident(updated);
        setTechnicalSyncError(null);
        showToast("Signalement technique annulé dans les deux applications");
      }).catch((error: unknown) => {
        setTechnicalSyncError(technicalErrorMessage(error));
        showToast(technicalErrorMessage(error));
      }).finally(() => setTechnicalBusy(false));
      return;
    }

    if (!removing && alert === "Problème technique") {
      setTechnicalBusy(true);
      setTechnicalSyncError(null);
      void (async () => {
        if (!cloudClient || !cloudContext) throw new Error("Connexion au socle Raccotel requise.");
        const incident = currentIncident
          ? await updateCloudTechnicalIncident(cloudClient, cloudContext, currentIncident.id, { workflowStatus: "detected" })
          : await ensureRoomTechnicalIncident(room);
        rememberTechnicalIncident(incident);
        updateRoom(room.number, { technicalIncidentId: incident.id });
        showToast(`Chambre ${room.number} · signalement transmis à Technique`);
      })().catch((error: unknown) => {
        setTechnicalSyncError(technicalErrorMessage(error));
        showToast(technicalErrorMessage(error));
      }).finally(() => setTechnicalBusy(false));
      return;
    }

    showToast(removing ? "Signalement retiré" : `${alert} ajouté`);
  };

  const updateTechnicalStatus = async (room: Room, technicalStatus: TechnicalStatus) => {
    if (!cloudClient || !cloudContext) {
      showToast("Connexion au socle Raccotel requise.");
      return;
    }
    setTechnicalBusy(true);
    setTechnicalSyncError(null);
    try {
      const existing = await ensureRoomTechnicalIncident(room);
      const updated = await updateCloudTechnicalIncident(cloudClient, cloudContext, existing.id, {
        workflowStatus: workflowForTechnicalStatus[technicalStatus],
      });
      rememberTechnicalIncident(updated);
      updateRoom(room.number, {
        technicalStatus,
        technicalIncidentId: updated.id,
        alert: technicalStatus === "Réparé" ? undefined : "Problème technique",
      });
      showToast(`Chambre ${room.number} · statut visible dans Technique`);
    } catch (error: unknown) {
      setTechnicalSyncError(technicalErrorMessage(error));
      showToast(technicalErrorMessage(error));
    } finally {
      setTechnicalBusy(false);
    }
  };

  const uploadTechnicalPhoto = (room: Room, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choisis une photo");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("La photo doit peser moins de 5 Mo");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateRoom(room.number, { technicalPhotoName: file.name, technicalPhotoData: String(reader.result) });
      setPendingRoomPhotos((current) => ({ ...current, [room.number]: file }));
      showToast("Photo prête · elle sera envoyée en enregistrant");
    };
    reader.readAsDataURL(file);
  };

  const saveRoomTechnicalDetails = async (room: Room) => {
    if (room.alert !== "Problème technique" && !room.technicalStatus) {
      setSelectedRoom(null);
      showToast(`Chambre ${room.number} enregistrée`);
      return;
    }
    if (!cloudClient || !cloudContext) {
      showToast("Connexion au socle Raccotel requise.");
      return;
    }
    setTechnicalBusy(true);
    setTechnicalSyncError(null);
    try {
      const existing = await ensureRoomTechnicalIncident(room);
      const pendingPhoto = pendingRoomPhotos[room.number];
      const photo = pendingPhoto
        ? await uploadCloudTechnicalPhoto(cloudClient, cloudContext.hotelId, pendingPhoto)
        : null;
      const description = room.floorComment?.trim() || room.receptionComment?.trim() || "";
      const updated = await updateCloudTechnicalIncident(cloudClient, cloudContext, existing.id, {
        title: description || existing.title,
        description,
        ...(photo ? { photoKey: photo.key, photoName: photo.name, photoType: photo.type } : {}),
      });
      rememberTechnicalIncident(updated);
      updateRoom(room.number, {
        technicalIncidentId: updated.id,
        technicalPhotoKey: updated.photoKey || undefined,
        technicalPhotoName: updated.photoName || undefined,
        technicalPhotoData: photo ? undefined : room.technicalPhotoData,
      });
      setPendingRoomPhotos((current) => {
        const next = { ...current };
        delete next[room.number];
        return next;
      });
      setSelectedRoom(null);
      showToast(`Chambre ${room.number} · Housekeeping et Technique synchronisés`);
    } catch (error: unknown) {
      setTechnicalSyncError(technicalErrorMessage(error));
      showToast(technicalErrorMessage(error));
    } finally {
      setTechnicalBusy(false);
    }
  };

  const openCommonArea = (area: CommonArea) => {
    setCommonAreaDraft({
      ...area,
      comment: area.comment ?? "",
      assignee: area.assignee ?? "",
      minutes: area.minutes ?? 0,
    });
    setCommonAreaErrors({});
  };

  const closeCommonArea = () => {
    setCommonAreaDraft(null);
    setPendingCommonAreaPhoto(null);
    setCommonAreaErrors({});
  };

  const selectCommonAreaAction = (action: CommonAreaAction) => {
    setCommonAreaDraft((current) => {
      if (!current) return current;
      const nextAction = current.action === action ? undefined : action;
      return {
        ...current,
        action: nextAction,
        assignee: nextAction === "Ménage" ? current.assignee : "",
        minutes: nextAction === "Ménage" ? current.minutes : 0,
        technicalStatus: nextAction === "Problème technique" ? (current.technicalStatus ?? "Détecté") : undefined,
        technicalIncidentId: nextAction === "Problème technique" ? current.technicalIncidentId : undefined,
        technicalPhotoKey: nextAction === "Problème technique" ? current.technicalPhotoKey : undefined,
        technicalPhotoName: nextAction === "Problème technique" ? current.technicalPhotoName : undefined,
        technicalPhotoData: nextAction === "Problème technique" ? current.technicalPhotoData : undefined,
      };
    });
    setCommonAreaErrors({});
  };

  const uploadCommonAreaTechnicalPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choisis une photo");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("La photo doit peser moins de 5 Mo");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCommonAreaDraft((current) => current ? {
        ...current,
        technicalPhotoName: file.name,
        technicalPhotoData: String(reader.result),
      } : current);
      setPendingCommonAreaPhoto(file);
      showToast("Photo prête · elle sera envoyée en enregistrant");
    };
    reader.readAsDataURL(file);
  };

  const updateCommonAreaTechnicalStatus = async (technicalStatus: TechnicalStatus) => {
    if (!commonAreaDraft || !cloudClient || !cloudContext) return;
    const existingBeforeUpdate = incidentForLocation("common_area", commonAreaDraft.name);
    if (!existingBeforeUpdate && !commonAreaDraft.comment?.trim()) {
      setCommonAreaDraft({ ...commonAreaDraft, technicalStatus });
      setCommonAreaErrors({ ...commonAreaErrors, comment: true });
      showToast("Ajoute le commentaire obligatoire puis enregistre le signalement");
      return;
    }
    setTechnicalBusy(true);
    setTechnicalSyncError(null);
    try {
      const existing = existingBeforeUpdate;
      const incident = existing
        ? await updateCloudTechnicalIncident(cloudClient, cloudContext, existing.id, {
            workflowStatus: workflowForTechnicalStatus[technicalStatus],
          })
        : await createCloudTechnicalIncident(cloudClient, cloudContext, {
            workDate,
            location: commonAreaDraft.name,
            locationType: "common_area",
            title: commonAreaDraft.comment?.trim() || "Problème technique",
            description: commonAreaDraft.comment?.trim() || "",
          });
      const updated = incident.workflowStatus === workflowForTechnicalStatus[technicalStatus]
        ? incident
        : await updateCloudTechnicalIncident(cloudClient, cloudContext, incident.id, {
            workflowStatus: workflowForTechnicalStatus[technicalStatus],
          });
      rememberTechnicalIncident(updated);
      setCommonAreaDraft((current) => current ? {
        ...current,
        technicalStatus,
        technicalIncidentId: updated.id,
        action: technicalStatus === "Réparé" ? current.action : "Problème technique",
      } : current);
      showToast(`${commonAreaDraft.name} · statut synchronisé`);
    } catch (error: unknown) {
      setTechnicalSyncError(technicalErrorMessage(error));
      showToast(technicalErrorMessage(error));
    } finally {
      setTechnicalBusy(false);
    }
  };

  const saveCommonArea = async () => {
    if (!commonAreaDraft) return;
    const errors: CommonAreaErrors = {
      comment: Boolean(commonAreaDraft.action && !commonAreaDraft.comment?.trim()),
      assignee: commonAreaDraft.action === "Ménage" && !commonAreaDraft.assignee,
      minutes: commonAreaDraft.action === "Ménage" && !(commonAreaDraft.minutes && commonAreaDraft.minutes > 0),
    };
    if (Object.values(errors).some(Boolean)) {
      setCommonAreaErrors(errors);
      showToast("Complète les champs obligatoires avant d’enregistrer");
      return;
    }

    let savedArea: CommonArea = {
      ...commonAreaDraft,
      comment: commonAreaDraft.action ? commonAreaDraft.comment?.trim() : "",
      assignee: commonAreaDraft.action === "Ménage" ? commonAreaDraft.assignee : "",
      minutes: commonAreaDraft.action === "Ménage" ? commonAreaDraft.minutes : 0,
      technicalStatus: commonAreaDraft.action === "Problème technique" ? (commonAreaDraft.technicalStatus ?? "Détecté") : undefined,
      technicalIncidentId: commonAreaDraft.action === "Problème technique" ? commonAreaDraft.technicalIncidentId : undefined,
      technicalPhotoKey: commonAreaDraft.action === "Problème technique" ? commonAreaDraft.technicalPhotoKey : undefined,
      technicalPhotoName: commonAreaDraft.action === "Problème technique" ? commonAreaDraft.technicalPhotoName : undefined,
      technicalPhotoData: commonAreaDraft.action === "Problème technique" ? commonAreaDraft.technicalPhotoData : undefined,
    };

    const existingIncident = incidentForLocation("common_area", commonAreaDraft.name);
    if (commonAreaDraft.action === "Problème technique") {
      if (!cloudClient || !cloudContext) {
        showToast("Connexion au socle Raccotel requise.");
        return;
      }
      setTechnicalBusy(true);
      setTechnicalSyncError(null);
      try {
        const photo = pendingCommonAreaPhoto
          ? await uploadCloudTechnicalPhoto(cloudClient, cloudContext.hotelId, pendingCommonAreaPhoto)
          : null;
        const baseIncident = existingIncident
          ? existingIncident
          : await createCloudTechnicalIncident(cloudClient, cloudContext, {
              workDate,
              location: commonAreaDraft.name,
              locationType: "common_area",
              title: commonAreaDraft.comment?.trim() || "Problème technique",
              description: commonAreaDraft.comment?.trim() || "",
            });
        const updated = await updateCloudTechnicalIncident(cloudClient, cloudContext, baseIncident.id, {
          title: commonAreaDraft.comment?.trim() || baseIncident.title,
          description: commonAreaDraft.comment?.trim() || "",
          ...(photo ? { photoKey: photo.key, photoName: photo.name, photoType: photo.type } : {}),
        });
        rememberTechnicalIncident(updated);
        savedArea = {
          ...savedArea,
          technicalStatus: technicalStatusForWorkflow[updated.workflowStatus],
          technicalIncidentId: updated.id,
          technicalPhotoKey: updated.photoKey || undefined,
          technicalPhotoName: updated.photoName || undefined,
          technicalPhotoData: photo ? undefined : savedArea.technicalPhotoData,
        };
      } catch (error: unknown) {
        setTechnicalSyncError(technicalErrorMessage(error));
        showToast(technicalErrorMessage(error));
        setTechnicalBusy(false);
        return;
      }
      setTechnicalBusy(false);
    } else if (existingIncident && technicalIncidentIsOpen(existingIncident) && cloudClient && cloudContext) {
      setTechnicalBusy(true);
      try {
        const cancelled = await updateCloudTechnicalIncident(cloudClient, cloudContext, existingIncident.id, {
          workflowStatus: "cancelled",
        });
        rememberTechnicalIncident(cancelled);
      } catch (error: unknown) {
        setTechnicalSyncError(technicalErrorMessage(error));
        showToast(technicalErrorMessage(error));
        setTechnicalBusy(false);
        return;
      }
      setTechnicalBusy(false);
    }
    setCommonAreas((current) => current.map((area) => area.id === savedArea.id ? savedArea : area));
    closeCommonArea();
    showToast(`${savedArea.name} enregistré dans les deux applications`);
  };

  const toggleDashboardSelection = (number: string) => {
    setDashboardSelectedRooms((current) => {
      const next = new Set(current);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  const toggleFloorSelection = (floorRooms: Room[]) => {
    setDashboardSelectedRooms((current) => {
      const next = new Set(current);
      const allSelected = floorRooms.every((room) => next.has(room.number));
      floorRooms.forEach((room) => allSelected ? next.delete(room.number) : next.add(room.number));
      return next;
    });
  };

  const applyBulkIntervention = (intervention: DayIntervention) => {
    if (!dashboardSelectedRooms.size) {
      showToast("Sélectionne au moins une chambre");
      return;
    }
    const count = dashboardSelectedRooms.size;
    setRooms((current) => current.map((room) => dashboardSelectedRooms.has(room.number) ? roomWithIntervention(room, intervention) : room));
    setDashboardSelectedRooms(new Set());
    showToast(`${count} chambre${count > 1 ? "s" : ""} passée${count > 1 ? "s" : ""} en ${intervention.toLowerCase()}`);
  };

  const applyBulkOutOfService = (outOfService: boolean) => {
    if (!dashboardSelectedRooms.size) {
      showToast("Sélectionne au moins une chambre");
      return;
    }
    const count = dashboardSelectedRooms.size;
    const persistentRooms = readPersistentOutOfServiceRooms();
    dashboardSelectedRooms.forEach((number) => outOfService ? persistentRooms.add(number) : persistentRooms.delete(number));
    writePersistentOutOfServiceRooms(persistentRooms);
    setRooms((current) => current.map((room) => dashboardSelectedRooms.has(room.number) ? { ...room, outOfService } : room));
    setDashboardSelectedRooms(new Set());
    showToast(`${count} chambre${count > 1 ? "s" : ""} ${outOfService ? "mise" : "remise"}${count > 1 ? "s" : ""} ${outOfService ? "hors service" : "en service"}`);
  };

  const changeRoomLayout = (room: Room, layout: string) => {
    updateRoom(room.number, { layout });
    showToast(layout === room.defaultLayout ? `Disposition d’origine rétablie en ${room.number}` : `Chambre ${room.number} · ${room.defaultLayout}->${layout}`);
  };

  const addPredefinedInstruction = (room: Room, instruction: string) => {
    const current = room.receptionComment?.trim() ?? "";
    const instructions = current ? current.split(" · ") : [];
    if (instructions.includes(instruction)) return;
    updateRoom(room.number, { receptionComment: [...instructions, instruction].join(" · ") });
  };

  const updatePredefinedInstruction = (index: number, value: string) => {
    setPredefinedInstructions((current) => current.map((instruction, instructionIndex) => instructionIndex === index ? value : instruction));
  };

  const removePredefinedInstruction = (index: number) => {
    setPredefinedInstructions((current) => current.filter((_, instructionIndex) => instructionIndex !== index));
  };

  const addPredefinedInstructionSetting = () => {
    const instruction = newPredefinedInstruction.trim();
    if (!instruction) return;
    if (predefinedInstructions.some((item) => item.toLocaleLowerCase("fr") === instruction.toLocaleLowerCase("fr"))) {
      showToast("Cette consigne existe déjà");
      return;
    }
    setPredefinedInstructions((current) => [...current, instruction]);
    setNewPredefinedInstruction("");
    showToast("Consigne prédéfinie ajoutée");
  };

  const addCommonAreaSetting = () => {
    const name = newCommonAreaName.trim();
    if (!name) return;
    if (commonAreas.some((area) => area.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
      showToast("Cette partie commune existe déjà");
      return;
    }
    setCommonAreas((current) => [...current, { id: crypto.randomUUID(), name, active: true, completed: false }]);
    setNewCommonAreaName("");
    showToast(`${name} ajouté au référentiel partagé`);
  };

  const renameCommonAreaSetting = (area: CommonArea, name: string) => {
    const nextName = name.trim();
    if (!nextName || nextName === area.name) return;
    if (technicalIncidents.some((incident) => incident.locationType === "common_area" && incident.location === area.name && technicalIncidentIsOpen(incident))) {
      showToast("Répare ou annule le signalement technique avant de renommer cette zone");
      return;
    }
    if (commonAreas.some((candidate) => candidate.id !== area.id && candidate.name.toLocaleLowerCase("fr") === nextName.toLocaleLowerCase("fr"))) {
      showToast("Ce nom existe déjà");
      return;
    }
    setCommonAreas((current) => current.map((candidate) => candidate.id === area.id ? { ...candidate, name: nextName } : candidate));
  };

  const moveCommonAreaSetting = (id: string, direction: -1 | 1) => {
    setCommonAreas((current) => {
      const index = current.findIndex((area) => area.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleCommonAreaArchive = (area: CommonArea) => {
    if (area.active !== false && technicalIncidents.some((incident) => incident.locationType === "common_area" && incident.location === area.name && technicalIncidentIsOpen(incident))) {
      showToast("Répare ou annule le signalement technique avant d’archiver cette zone");
      return;
    }
    setCommonAreas((current) => current.map((candidate) => candidate.id === area.id ? { ...candidate, active: area.active === false } : candidate));
  };

  const markRemainingFree = () => {
    if (!prepStats.unclassified) return;
    const confirmed = window.confirm(
      `Classer les ${prepStats.unclassified} chambre${prepStats.unclassified > 1 ? "s" : ""} encore non renseignée${prepStats.unclassified > 1 ? "s" : ""} en Libre ?\n\nLes chambres déjà renseignées ne seront pas modifiées.`,
    );
    if (!confirmed) return;
    setRooms((current) => current.map((room) => room.intervention === null ? roomWithIntervention(room, "Libre") : room));
    showToast(`${prepStats.unclassified} chambre${prepStats.unclassified > 1 ? "s" : ""} classée${prepStats.unclassified > 1 ? "s" : ""} libre${prepStats.unclassified > 1 ? "s" : ""}`);
  };

  const goToTeam = () => {
    if (prepStats.unclassified) {
      showToast(`Il reste ${prepStats.unclassified} chambre${prepStats.unclassified > 1 ? "s" : ""} à renseigner`);
      return;
    }
    setDistributionStep("team");
    setPage("distribution");
  };

  const updateEmployee = (id: number, patch: Partial<Employee>) => {
    setEmployees((current) => current.map((employee) => employee.id === id ? { ...employee, ...patch } : employee));
  };

  const addAnnexTask = (employee: Employee) => {
    const nextId = Math.max(...employee.annexTasks.map((task) => task.id), 0) + 1;
    updateEmployee(employee.id, { annexTasks: [...employee.annexTasks, { id: nextId, label: "", minutes: 0 }] });
  };

  const updateAnnexTask = (employee: Employee, taskId: number, patch: Partial<AnnexTask>) => {
    updateEmployee(employee.id, {
      annexTasks: employee.annexTasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
    });
  };

  const removeAnnexTask = (employee: Employee, taskId: number) => {
    updateEmployee(employee.id, { annexTasks: employee.annexTasks.filter((task) => task.id !== taskId) });
  };

  const toggleOutOfService = (room: Room) => {
    const nextOutOfService = !room.outOfService;
    const persistentRooms = readPersistentOutOfServiceRooms();
    if (nextOutOfService) persistentRooms.add(room.number);
    else persistentRooms.delete(room.number);
    writePersistentOutOfServiceRooms(persistentRooms);
    updateRoom(room.number, { outOfService: nextOutOfService });
    showToast(`Chambre ${room.number} · ${room.outOfService ? "remise en service" : "hors service"}`);
  };

  const addAccount = async () => {
    const name = newAccountName.trim();
    if (!name) return;
    if (cloudClient && cloudContext) {
      if (!newAccountEmail.trim()) {
        showToast("Renseigne l’adresse e-mail du compte");
        return;
      }
      try {
        await upsertCloudMember(cloudClient, {
          email: newAccountEmail,
          displayName: name,
          role: newAccountRole,
          active: true,
        });
        await refreshCloudMembers();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Impossible d’ajouter ce compte");
        return;
      }
      setNewAccountName("");
      setNewAccountEmail("");
      setNewAccountRole("Réception");
      showToast(`Compte ${name} autorisé`);
      return;
    }
    setAccounts((current) => [...current, {
      id: Math.max(...current.map((account) => account.id), 0) + 1,
      name,
      email: newAccountEmail.trim() || undefined,
      role: newAccountRole,
      active: true,
    }]);
    setNewAccountName("");
    setNewAccountEmail("");
    setNewAccountRole("Réception");
    showToast(`Compte ${name} ajouté`);
  };

  const updateAccount = (id: number, patch: Partial<UserAccount>) => {
    setAccounts((current) => current.map((account) => account.id === id ? { ...account, ...patch } : account));
  };

  const saveCloudAccount = async (account: UserAccount) => {
    if (!cloudClient || !cloudContext || !account.email) return;
    try {
      await upsertCloudMember(cloudClient, {
        email: account.email,
        displayName: account.name,
        role: account.role,
        active: account.active,
      });
      await refreshCloudMembers();
      showToast(`Compte ${account.name} mis à jour`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Modification impossible");
    }
  };

  const toggleAccount = async (account: UserAccount) => {
    if (account.email?.toLowerCase() === cloudContext?.email.toLowerCase() || (!cloudContext && account.id === currentAccountId)) {
      showToast("Le compte actuellement utilisé ne peut pas être archivé");
      return;
    }
    if (cloudClient && cloudContext && account.email) {
      try {
        await upsertCloudMember(cloudClient, {
          email: account.email,
          displayName: account.name,
          role: account.role,
          active: !account.active,
        });
        await refreshCloudMembers();
        showToast(`${account.name} ${account.active ? "archivé" : "réactivé"}`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Modification impossible");
      }
      return;
    }
    updateAccount(account.id, { active: !account.active });
    showToast(`${account.name} ${account.active ? "archivé" : "réactivé"}`);
  };

  const requestAdminAccess = (accountId: number | null, openSettings: boolean) => {
    const target = accounts.find((account) => account.id === accountId && account.active && account.role === "Administrateur")
      ?? accounts.find((account) => account.active && account.role === "Administrateur");
    if (!target) {
      showToast("Aucun compte administrateur actif");
      return;
    }
    setPendingAdminAccountId(target.id);
    setOpenSettingsAfterLogin(openSettings);
    setAdminLoginPassword("");
    setAdminLoginError(false);
    setShowAccountMenu(false);
    setShowAdminLogin(true);
  };

  const openSettings = () => {
    setMobileNav(false);
    setShowAccountMenu(false);
    if (cloudContext) {
      if (currentAccount.role !== "Administrateur") {
        showToast("Paramètres réservés au compte administrateur");
        return;
      }
      setPage("settings");
      return;
    }
    if (canManageSettings) {
      setPage("settings");
      return;
    }
    requestAdminAccess(currentAccount.role === "Administrateur" ? currentAccount.id : null, true);
  };

  const submitAdminLogin = () => {
    if (adminLoginPassword !== adminPassword) {
      setAdminLoginError(true);
      return;
    }
    const target = accounts.find((account) => account.id === pendingAdminAccountId && account.active && account.role === "Administrateur")
      ?? accounts.find((account) => account.active && account.role === "Administrateur");
    if (!target) {
      setAdminLoginError(true);
      return;
    }
    setCurrentAccountId(target.id);
    setAdminUnlocked(true);
    setShowAdminLogin(false);
    setAdminLoginPassword("");
    setAdminLoginError(false);
    if (openSettingsAfterLogin) setPage("settings");
    showToast(`Compte administrateur ouvert : ${target.name}`);
  };

  const switchAccount = (account: UserAccount) => {
    if (account.role === "Administrateur") {
      if (account.id === currentAccountId && adminUnlocked) {
        setShowAccountMenu(false);
        return;
      }
      requestAdminAccess(account.id, false);
      return;
    }
    setCurrentAccountId(account.id);
    setAdminUnlocked(false);
    setShowAccountMenu(false);
    if (page === "settings") setPage("dashboard");
    showToast(`Compte actif : ${account.name}`);
  };

  const saveSettings = () => {
    if (!cloudContext && !adminPassword.trim()) {
      showToast("Le mot de passe administrateur ne peut pas être vide");
      return;
    }
    showToast(cloudContext ? "Paramètres enregistrés et synchronisés" : "Paramètres enregistrés sur cet appareil");
  };

  const toggleAlertSetting = (kind: keyof AlertSettings) => {
    setAlertSettings((current) => ({ ...current, [kind]: !current[kind] }));
  };

  const updateEmployeeSchedule = (employee: Employee, field: "start" | "end", value: string) => {
    const nextStart = field === "start" ? value : employee.start;
    const nextEnd = field === "end" ? value : employee.end;
    updateEmployee(employee.id, { [field]: value, presenceMinutes: minutesBetween(nextStart, nextEnd) });
  };

  const openEmployeeEditFromDistribution = (employee: Employee) => {
    setPage("personnel");
    setPersonnelView("active");
    setEditingEmployee({ ...employee });
  };

  const openRoomSettings = () => {
    setRoomSettingsDraft(rooms.map((room) => ({ ...room })));
    setShowRoomSettings(true);
  };

  const updateRoomSettingsDraft = (id: number, patch: Partial<Room>) => {
    setRoomSettingsDraft((current) => current.map((room) => {
      if (room.id !== id) return room;
      if (patch.defaultLayout && patch.defaultLayout !== room.defaultLayout) {
        return {
          ...room,
          ...patch,
          layout: room.layout === room.defaultLayout ? patch.defaultLayout : room.layout,
        };
      }
      return { ...room, ...patch };
    }));
  };

  const addRoomSettingsDraft = () => {
    const nextId = Math.max(...roomSettingsDraft.map((room) => room.id), 0) + 1;
    setRoomSettingsDraft((current) => [...current, {
      id: nextId,
      number: "",
      category: "CLASSIQUE",
      layout: "DBL",
      defaultLayout: "DBL",
      status: "LP",
      intervention: null,
      housekeeper: "",
      progress: "À faire",
      outOfService: false,
      arrivalToday: false,
    }]);
  };

  const saveRoomSettings = () => {
    const normalized = roomSettingsDraft.map((room) => ({
      ...room,
      number: room.number.trim().toUpperCase(),
      category: room.category.trim().toUpperCase(),
    }));
    if (normalized.some((room) => !room.number || !room.category)) {
      showToast("Renseigne le numéro et la typologie de chaque chambre");
      return;
    }
    if (new Set(normalized.map((room) => room.number)).size !== normalized.length) {
      showToast("Deux chambres ne peuvent pas porter le même numéro");
      return;
    }
    setRooms(normalized);
    const validNumbers = new Set(normalized.map((room) => room.number));
    setDashboardSelectedRooms((current) => new Set([...current].filter((number) => validNumbers.has(number))));
    setSelectedRooms((current) => new Set([...current].filter((number) => validNumbers.has(number))));
    if (selectedRoom && !validNumbers.has(selectedRoom)) setSelectedRoom(null);
    setShowRoomSettings(false);
    showToast(`Référentiel enregistré · ${normalized.length} chambres`);
  };

  const saveEmployeeEdit = () => {
    if (!editingEmployee?.name.trim()) return;
    const previous = employees.find((employee) => employee.id === editingEmployee.id);
    if (!previous) return;
    const nextName = editingEmployee.name.trim();
    const nextEmployee = {
      ...editingEmployee,
      name: nextName,
      lastName: editingEmployee.lastName.trim(),
      presenceMinutes: minutesBetween(editingEmployee.start, editingEmployee.end),
    };
    const nextEmployees = employees.map((employee) => employee.id === nextEmployee.id ? nextEmployee : employee);
    setEmployees(nextEmployees);
    const directory = readEmployeeDirectory() ?? employees.map(employeeDirectoryRecord);
    writeEmployeeDirectory(directory.map((employee) => employee.id === nextEmployee.id ? employeeDirectoryRecord(nextEmployee) : employee));
    if (previous.name !== nextName) {
      setRooms((current) => current.map((room) => room.housekeeper === previous.name ? { ...room, housekeeper: nextName } : room));
      if (assignTarget === previous.name) setAssignTarget(nextName);
      if (phoneEmployee === previous.name) setPhoneEmployee(nextName);
    }
    setEditingEmployee(null);
    showToast(`Fiche de ${employeeFullName(nextEmployee)} modifiée`);
  };

  const changeEmployeeArchiveState = (employee: Employee, active: boolean) => {
    updateEmployee(employee.id, { active, presentToday: active ? false : employee.presentToday });
    const directory = readEmployeeDirectory() ?? employees.map(employeeDirectoryRecord);
    writeEmployeeDirectory(directory.map((profile) => profile.id === employee.id ? { ...profile, active } : profile));
    if (!active) {
      setRooms((current) => current.map((room) => room.housekeeper === employee.name ? { ...room, housekeeper: "" } : room));
      setSelectedRooms(new Set());
      const replacement = employees.find((candidate) => candidate.id !== employee.id && candidate.active && candidate.presentToday);
      if (assignTarget === employee.name) setAssignTarget(replacement?.name ?? "");
      if (phoneEmployee === employee.name) setPhoneEmployee(replacement?.name ?? "");
      showToast(`${employee.name} archivée · ses chambres sont à réattribuer`);
      return;
    }
    showToast(`${employee.name} réactivée dans le personnel actif`);
  };

  const togglePresence = (employee: Employee) => {
    const presentToday = !employee.presentToday;
    updateEmployee(employee.id, { presentToday });
    if (!presentToday) {
      setRooms((current) => current.map((room) => room.housekeeper === employee.name ? { ...room, housekeeper: "" } : room));
      setSelectedRooms(new Set());
      if (assignTarget === employee.name) {
        const replacement = employees.find((candidate) => candidate.active && candidate.presentToday && candidate.id !== employee.id);
        if (replacement) setAssignTarget(replacement.name);
      }
    }
  };

  const updateProgress = (room: Room, progress: Progress) => {
    const patch: Partial<Room> = { progress };
    if (progress === "Contrôlée" || progress === "Validée sans contrôle") {
      patch.status = room.intervention === "Recouche" ? "OP" : "LP";
    }
    updateRoom(room.number, patch);
    showToast(`Chambre ${room.number} · ${progress}`);
  };

  const toggleSelection = (number: string) => {
    setSelectedRooms((current) => {
      const next = new Set(current);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  const assignSelected = (selection = selectedRooms) => {
    if (!selection.size) {
      showToast("Sélectionne au moins une chambre");
      return;
    }
    if (!presentEmployees.some((employee) => employee.name === assignTarget)) {
      showToast("Choisis une personne présente dans l’équipe du jour");
      return;
    }
    setRooms((current) => current.map((room) => (selection.has(room.number) ? { ...room, housekeeper: assignTarget } : room)));
    showToast(`${selection.size} chambre${selection.size > 1 ? "s" : ""} attribuée${selection.size > 1 ? "s" : ""} à ${assignTarget}`);
    setSelectedRooms(new Set());
  };

  const setDelivery = (id: number, delivery: DeliveryMethod) => {
    setEmployees((current) => current.map((employee) => (employee.id === id ? { ...employee, delivery } : employee)));
  };

  const generateDashboardPdf = async () => {
    const doc = new jsPDF({ orientation: "landscape" });
    try {
      const [hotelLogoData, groupLogoData] = await Promise.all([
        imageAsDataUrl(hotelLogo),
        imageAsDataUrl(groupLogo),
      ]);
      doc.addImage(hotelLogoData, imageFormat(hotelLogoData), 12, 7, 36, 23);
      doc.addImage(groupLogoData, imageFormat(groupLogoData), 254, 8, 29, 18);
    } catch {
      // La sauvegarde reste exploitable même si les logos ne peuvent pas être chargés.
    }

    doc.setTextColor(17, 43, 60);
    doc.setFontSize(18);
    doc.text(`Tableau du jour · ${longDateLabel(workDate)}`, 57, 17);
    doc.setFontSize(9);
    doc.setTextColor(102, 119, 129);
    doc.text(`${hotelName} · ${hotelAddress}`, 57, 23);
    doc.text(
      `${prepStats.blanks} à blanc · ${prepStats.stayovers} recouches · ${prepStats.free} libres · ${prepStats.outOfService} HS · ${prepStats.remainingToControl} restant à contrôler`,
      57,
      29,
    );

    const orderedRooms = [...rooms].sort((a, b) => a.number.localeCompare(b.number, "fr", { numeric: true }));
    autoTable(doc, {
      startY: 36,
      head: [["Étage", "Ch.", "Type", "Disposition", "Situation", "Client", "HS", "Arrivée", "Attribuée à", "Contrôle", "Technique", "Consignes"]],
      body: orderedRooms.map((room) => [
        room.number.charAt(0),
        room.number,
        room.category,
        room.layout === room.defaultLayout ? room.layout : `${room.defaultLayout}->${room.layout}`,
        room.intervention ?? "À renseigner",
        housekeeperSituation(room) || "—",
        room.outOfService ? "OUI" : "—",
        room.arrivalToday ? "OUI" : "—",
        room.housekeeper || "À attribuer",
        room.progress === "Contrôlée" ? "Contrôlée" : room.progress === "Validée sans contrôle" ? "Validée" : room.progress,
        room.technicalStatus ?? "—",
        [housekeeperInstruction(room), room.floorComment, room.alert && room.alert !== "Problème technique" ? room.alert : ""].filter(Boolean).join(" · ") || "—",
      ]),
      styles: { fontSize: 6.4, cellPadding: 1.8, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [17, 43, 60], fontSize: 6.7 },
      alternateRowStyles: { fillColor: [247, 246, 242] },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 12, fontStyle: "bold" },
        2: { cellWidth: 20 },
        3: { cellWidth: 22 },
        4: { cellWidth: 19, fontStyle: "bold" },
        5: { cellWidth: 14 },
        6: { cellWidth: 9, textColor: [190, 32, 32], fontStyle: "bold" },
        7: { cellWidth: 12 },
        8: { cellWidth: 24 },
        9: { cellWidth: 22 },
        10: { cellWidth: 18 },
        11: { cellWidth: 72 },
      },
      margin: { left: 10, right: 10 },
    });

    const pageCount = doc.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      doc.setPage(pageNumber);
      doc.setFontSize(7);
      doc.setTextColor(102, 119, 129);
      doc.text(`Sauvegarde du tableau de bord · page ${pageNumber}/${pageCount}`, 10, 204);
    }
    doc.save(`tableau-du-jour-${workDate}.pdf`);
    showToast("PDF de secours du tableau de bord généré");
  };

  const generateIndividualPdf = async (employee: Employee) => {
    const employeeRooms = rooms.filter((room) => room.housekeeper === employee.name);
    const blankRooms = employeeRooms.filter((room) => room.intervention === "À blanc");
    const stayoverRooms = employeeRooms.filter((room) => room.intervention === "Recouche");
    const doc = new jsPDF();
    try {
      const [hotelLogoData, groupLogoData] = await Promise.all([
        imageAsDataUrl(hotelLogo),
        imageAsDataUrl(groupLogo),
      ]);
      doc.addImage(hotelLogoData, imageFormat(hotelLogoData), 14, 10, 42, 26);
      doc.addImage(groupLogoData, imageFormat(groupLogoData), 164, 11, 30, 19);
    } catch {
      // Le PDF reste utilisable si un navigateur bloque le chargement des images.
    }
    doc.setTextColor(17, 43, 60);
    doc.setFontSize(18);
    doc.text(`Feuille de chambres · ${employeeFullName(employee)}`, 14, 47);
    doc.setFontSize(10);
    doc.setTextColor(102, 119, 129);
    doc.text(`${hotelName} · ${longDateLabel(workDate)} · ${employeeRooms.length} chambres`, 14, 54);

    let nextY = 61;
    const drawRoomSection = (
      title: string,
      sectionRooms: Room[],
      color: [number, number, number],
      includeClient: boolean,
    ) => {
      if (nextY > 258) {
        doc.addPage();
        nextY = 15;
      }
      doc.setFillColor(...color);
      doc.roundedRect(14, nextY, 182, 10, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`${title} · ${sectionRooms.length} chambre${sectionRooms.length > 1 ? "s" : ""}`, 18, nextY + 6.8);
      doc.setFont("helvetica", "normal");
      if (!sectionRooms.length) {
        doc.setTextColor(102, 119, 129);
        doc.setFontSize(9);
        doc.text("Aucune chambre dans cette catégorie.", 18, nextY + 17);
        nextY += 25;
        return;
      }
      autoTable(doc, {
        startY: nextY + 12,
        head: [includeClient
          ? ["Chambre", "Client", "Type", "Disposition", "Consignes"]
          : ["Chambre", "Type", "Disposition", "Consignes"]],
        body: sectionRooms.map((room) => includeClient
          ? [room.number, housekeeperSituation(room), room.category, room.layout, housekeeperInstruction(room) || "—"]
          : [room.number, room.category, room.layout, housekeeperInstruction(room) || "—"]),
        styles: { fontSize: 9, cellPadding: 3, valign: "middle" },
        headStyles: { fillColor: [17, 43, 60] },
        alternateRowStyles: { fillColor: [247, 246, 242] },
        columnStyles: includeClient
          ? { 0: { fontStyle: "bold", fontSize: 11, cellWidth: 22 }, 1: { fontStyle: "bold", cellWidth: 24 }, 4: { cellWidth: 66 } }
          : { 0: { fontStyle: "bold", fontSize: 11, cellWidth: 22 }, 3: { cellWidth: 78 } },
        margin: { left: 14, right: 14 },
      });
      nextY = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? nextY + 25) + 12;
    };

    drawRoomSection("À BLANC", blankRooms, [184, 119, 14], true);
    drawRoomSection("RECOUCHES", stayoverRooms, [23, 105, 194], false);
    if (nextY > 260) {
      doc.addPage();
      nextY = 18;
    }
    doc.setFontSize(11);
    doc.setTextColor(17, 43, 60);
    doc.text(doc.splitTextToSize(`Tâches annexes et communs : ${employeeAnnexSummary(employee, commonAreas)}`, 180), 14, nextY);
    doc.text(`Horaires : ${employee.start}–${employee.end} · Pause : ${employee.pause} min`, 14, nextY + 16);
    doc.save(`feuille-${employeeFullName(employee).toLowerCase().replaceAll(" ", "-")}-${workDate}.pdf`);
    showToast(`Feuille PDF de ${employeeFullName(employee)} générée`);
  };

  const generateReportPdf = async () => {
    if (!reportComment.trim()) {
      setReportCommentError(true);
      showToast("Ajoute un commentaire au rapport, même simplement « RAS »");
      return;
    }
    setReportCommentError(false);
    const doc = new jsPDF({ orientation: "landscape" });
    try {
      const [hotelLogoData, groupLogoData] = await Promise.all([
        imageAsDataUrl(hotelLogo),
        imageAsDataUrl(groupLogo),
      ]);
      doc.addImage(hotelLogoData, imageFormat(hotelLogoData), 14, 8, 42, 26);
      doc.addImage(groupLogoData, imageFormat(groupLogoData), 250, 9, 30, 19);
    } catch {
      // Le contenu du rapport ne dépend pas des images.
    }
    doc.setTextColor(17, 43, 60);
    doc.setFontSize(19);
    doc.text(`Rapport d'étage · ${longDateLabel(workDate)}`, 66, 20);
    doc.setFontSize(10);
    doc.setTextColor(102, 119, 129);
    doc.text(`${rooms.length} chambres · ${prepStats.serviceRooms} interventions · ${dayEvents.length} événement${dayEvents.length > 1 ? "s" : ""}`, 66, 27);
    const totalRooms = reportRows.reduce((total, row) => total + row.rooms, 0);
    const totalCharge = reportRows.reduce((total, row) => total + row.totalCharge, 0);
    const totalRoomAvailable = reportRows.reduce((total, row) => total + row.available, 0);
    const totalNetDay = reportRows.reduce((total, row) => total + row.netDay, 0);
    const globalCadence = totalRoomAvailable ? totalRooms / (totalRoomAvailable / 60) : 0;
    const globalLoad = totalNetDay ? Math.round((totalCharge / totalNetDay) * 100) : 0;
    doc.setTextColor(17, 43, 60);
    doc.setFontSize(10);
    doc.text(`Productivité globale : ${globalCadence.toFixed(2)} ch/h · Charge pondérée : ${globalLoad} %`, 66, 34);
    autoTable(doc, {
      startY: 44,
      head: [["Femme de chambre", "À blanc", "Recouches", "Total", "Présence", "Pause", "Tâches annexes", "Cadence", "Charge"]],
      body: reportRows.map((row) => [
        row.name,
        row.blanks,
        row.stayovers,
        row.rooms,
        minutesToHours(row.presence),
        `${row.pause} min`,
        row.annex,
        `${row.cadence.toFixed(2)} ch/h`,
        `${Math.round(row.load)} %`,
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [17, 43, 60] },
      alternateRowStyles: { fillColor: [247, 246, 242] },
    });
    const endY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(12);
    doc.setTextColor(17, 43, 60);
    doc.text("Événements de la journée", 14, endY + 14);
    doc.setFontSize(9);
    if (dayEvents.length) {
      dayEvents.slice(0, 6).forEach((room, index) => {
        doc.text(`Chambre ${room.number} · ${roomEventLabel(room)} · ${room.floorComment ?? room.receptionComment ?? "Sans commentaire"}${room.technicalPhotoName ? " · Photo jointe" : ""}`, 14, endY + 22 + index * 7);
      });
    } else {
      doc.text("Aucun événement déclaré.", 14, endY + 22);
    }
    const commentY = endY + 30 + Math.min(dayEvents.length, 6) * 7;
    if (commentY > 180) {
      doc.addPage("a4", "landscape");
      doc.setFontSize(12);
      doc.setTextColor(17, 43, 60);
      doc.text("Commentaire de la gouvernante", 14, 18);
      doc.setFontSize(10);
      doc.text(doc.splitTextToSize(reportComment.trim(), 265), 14, 28);
    } else {
      doc.setFontSize(12);
      doc.setTextColor(17, 43, 60);
      doc.text("Commentaire de la gouvernante", 14, commentY);
      doc.setFontSize(10);
      doc.text(doc.splitTextToSize(reportComment.trim(), 265), 14, commentY + 9);
    }
    doc.save(`rapport-etages-${workDate}.pdf`);
    showToast("Rapport d'étage PDF généré");
  };

  const addEmployee = () => {
    if (!newEmployee.name.trim()) return;
    const employee: Employee = {
      id: Math.max(...employees.map((person) => person.id), 0) + 1,
      name: newEmployee.name.trim(),
      lastName: newEmployee.lastName.trim(),
      contract: newEmployee.contract,
      start: newEmployee.start,
      end: newEmployee.end,
      presenceMinutes: minutesBetween(newEmployee.start, newEmployee.end),
      pause: newEmployee.pause,
      annexTasks: [],
      active: true,
      presentToday: true,
      delivery: newEmployee.delivery,
    };
    setEmployees((current) => [...current, employee]);
    const directory = readEmployeeDirectory() ?? employees.map(employeeDirectoryRecord);
    writeEmployeeDirectory([...directory, employeeDirectoryRecord(employee)]);
    setNewEmployee({ name: "", lastName: "", contract: "30 h", start: "09:30", end: "16:00", pause: defaultPauseMinutes, delivery: "pdf" });
    setShowAddEmployee(false);
    showToast("Femme de chambre ajoutée");
  };

  if (cloudClient && !authReady) {
    return (
      <main className="pilot-gate">
        <div className="pilot-gate-card loading-card">
          <img src="/raccoon-housekeeping-icon.png" alt="Raccoon Housekeeping" />
          <span className="loading-spinner" />
          <h1>Raccoon Housekeeping</h1>
          <p>Ouverture de l’application…</p>
        </div>
      </main>
    );
  }

  if (cloudClient && authMode === "recovery") {
    return (
      <main className="pilot-gate">
        <form className="pilot-gate-card auth-card" onSubmit={submitRecoveryPassword}>
          <img src="/raccoon-housekeeping-icon.png" alt="Raccotel Housekeeping" />
          <p className="eyebrow">Réinitialisation sécurisée</p>
          <h1>Nouveau mot de passe</h1>
          <p>Choisis un nouveau mot de passe pour ton compte. L’administrateur ne pourra ni le voir ni le modifier.</p>
          <label><span>Nouveau mot de passe</span><input type="password" autoComplete="new-password" minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="6 caractères minimum" /></label>
          {authError && <div className="auth-message error"><CircleAlert size={16} />{authError}</div>}
          <button className="button primary auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Enregistrement…" : "Enregistrer le nouveau mot de passe"}</button>
        </form>
      </main>
    );
  }

  if (cloudClient && !authUserEmail) {
    if (authMode === "forgot") {
      return (
        <main className="pilot-gate">
          <form className="pilot-gate-card auth-card" onSubmit={requestPasswordReset}>
            <img src="/raccoon-housekeeping-icon.png" alt="Raccotel Housekeeping" />
            <p className="eyebrow">Accès au compte</p>
            <h1>Mot de passe oublié</h1>
            <p>Indique l’adresse du compte. Le lien permettra uniquement de choisir un nouveau mot de passe.</p>
            <label><span>Adresse e-mail</span><input type="email" autoComplete="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="prenom@hotel.fr" /></label>
            {authError && <div className={`auth-message ${authError.startsWith("Si cette adresse") ? "success" : "error"}`}><CircleAlert size={16} />{authError}</div>}
            <button className="button primary auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Envoi…" : "Envoyer le lien"}</button>
            <button className="auth-switch" type="button" onClick={() => { setAuthMode("login"); setAuthError(null); }}>Retour à la connexion</button>
          </form>
        </main>
      );
    }
    return (
      <main className="pilot-gate">
        <form className="pilot-gate-card auth-card" onSubmit={submitCloudAuth}>
          <img src="/raccoon-housekeeping-icon.png" alt="Raccotel Housekeeping" />
          <p className="eyebrow">Accès sécurisé</p>
          <h1>Raccotel Housekeeping</h1>
          <p>Connecte-toi pour retrouver la journée de l’hôtel sur tous les appareils autorisés.</p>
          <label><span>Adresse e-mail</span><input type="email" autoComplete="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="prenom@hotel.fr" /></label>
          <label><span>Mot de passe</span><input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="6 caractères minimum" /></label>
          {authError && <div className={`auth-message ${authError.startsWith("Compte créé") ? "success" : "error"}`}><CircleAlert size={16} />{authError}</div>}
          <button className="button primary auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Connexion…" : authMode === "login" ? "Se connecter" : "Créer mon compte"}</button>
          <div className="auth-secondary-actions">
            <button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(null); }}>
              {authMode === "login" ? "Première connexion" : "J’ai déjà un compte"}
            </button>
            {authMode === "login" && <button className="auth-switch" type="button" onClick={() => { setAuthMode("forgot"); setAuthError(null); setAuthPassword(""); }}>Mot de passe oublié</button>}
          </div>
          <small>Pour une première connexion, l’adresse doit d’abord avoir été autorisée par l’administrateur dans Paramètres.</small>
        </form>
      </main>
    );
  }

  if (cloudClient && authUserEmail && cloudContextError) {
    return (
      <main className="pilot-gate">
        <div className="pilot-gate-card access-card">
          <img src="/raccoon-housekeeping-icon.png" alt="Raccoon Housekeeping" />
          <CircleAlert className="access-alert" size={30} />
          <h1>Compte non autorisé</h1>
          <p>{cloudContextError}</p>
          <strong>{authUserEmail}</strong>
          <button className="button secondary" onClick={signOutCloud}><LogOut size={17} /> Utiliser un autre compte</button>
        </div>
      </main>
    );
  }

  if ((cloudClient && !cloudContext) || !hydrated) {
    return (
      <main className="pilot-gate">
        <div className="pilot-gate-card loading-card">
          <img src="/raccoon-housekeeping-icon.png" alt="Raccoon Housekeeping" />
          <span className="loading-spinner" />
          <h1>Raccoon Housekeeping</h1>
          <p>Chargement de la journée du {shortDateLabel(workDate)}…</p>
        </div>
      </main>
    );
  }

  const syncPresentation = {
    loading: { label: "Chargement", icon: <Wifi size={13} /> },
    local: { label: "Sauvegardé sur cet appareil", icon: <CloudOff size={13} /> },
    saving: { label: "Synchronisation…", icon: <Cloud size={13} /> },
    synced: { label: "Synchronisé", icon: <Cloud size={13} /> },
    offline: { label: "Hors ligne · sauvegarde locale", icon: <CloudOff size={13} /> },
    error: { label: "Sauvegarde à vérifier", icon: <CircleAlert size={13} /> },
  }[syncStatus];

  const pageTitle = {
    dashboard: "Tableau de bord",
    distribution: "Distribution des chambres",
    personnel: "Personnel",
    reports: "Rapport d’étage",
    settings: "Paramètres de l’hôtel",
  }[page];

  const renderDashboard = () => {
    const classified = rooms.length - prepStats.unclassified;
    const floors = Array.from(new Set(rooms.map((room) => room.number.charAt(0)).filter(Boolean))).sort();
    const activeCommonAreas = commonAreas.filter((area) => area.active !== false);
    const completedCommonAreas = activeCommonAreas.filter((area) => area.completed).length;
    const dashboardTabs = (
      <nav className="dashboard-tabs" aria-label="Tableaux du jour">
        <button className={dashboardView === "rooms" ? "active" : ""} onClick={() => setDashboardView("rooms")}>
          <BedDouble size={17} /> Tableau des chambres <span>{rooms.length}</span>
        </button>
        <button className={dashboardView === "commons" ? "active" : ""} onClick={() => setDashboardView("commons")}>
          <Building2 size={17} /> Tableau des communs <span>{activeCommonAreas.length}</span>
        </button>
      </nav>
    );

    if (dashboardView === "commons") {
      return (
        <>
          {dashboardTabs}
          <section className="common-heading">
            <div>
              <p className="eyebrow">Parties communes · {shortDateLabel(workDate)}</p>
              <h2>Tableau des espaces communs</h2>
              <p>Retrouve ici les couloirs, circulations et espaces de l’hôtel, sans modifier le tableau des chambres.</p>
            </div>
            <div className="common-progress"><strong>{completedCommonAreas} / {activeCommonAreas.length}</strong><span>contrôlés aujourd’hui</span></div>
          </section>
          <section className="common-area-grid" aria-label="Tableau des parties communes">
            {activeCommonAreas.map((area) => (
              <button
                type="button"
                key={area.id}
                className={`common-area-card ${area.completed ? "completed" : ""} ${area.action ? "has-action" : ""}`}
                onClick={() => openCommonArea(area)}
                aria-label={`Ouvrir la fiche de ${area.name}`}
              >
                <span>{area.name}</span>
                <span className="common-card-statuses">
                  {area.action === "Ménage" && <small className="cleaning"><Sparkles size={14} /> Ménage · {area.assignee} · {area.minutes} min</small>}
                  {area.action === "Problème technique" && <small className="technical"><Wrench size={14} /> Problème technique · {area.technicalStatus ?? "Détecté"}{area.technicalPhotoName ? " · Photo jointe" : ""}</small>}
                  {area.completed && <small className="controlled"><CheckCircle2 size={14} /> Contrôlé</small>}
                  {!area.action && !area.completed && <small>À renseigner</small>}
                </span>
              </button>
            ))}
          </section>
        </>
      );
    }

    return (
      <>
        {dashboardTabs}
        <section className="prep-intro">
          <div>
            <p className="eyebrow">Préparation du {shortDateLabel(workDate)}</p>
            <h2>Indique la situation de chaque chambre</h2>
            <p>Un clic par chambre, comme sur la feuille actuelle. Les compteurs et la charge de travail se calculent automatiquement.</p>
          </div>
          <div className="prep-actions">
            <button className="button secondary dashboard-pdf-button" onClick={generateDashboardPdf}>
              <FileDown size={18} /> Sauvegarder le tableau en PDF
            </button>
            <button className="button remaining-free-button" onClick={markRemainingFree} disabled={!prepStats.unclassified}>
              <CheckCircle2 size={18} /> Classer toutes les restantes en Libre
            </button>
            <button className="button primary" onClick={goToTeam}>
              Choisir l’équipe <ChevronRight size={18} />
            </button>
          </div>
        </section>

        <section className={`dashboard-bulk-bar ${dashboardSelectedRooms.size ? "active" : ""}`} aria-label="Modification groupée des chambres">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              checked={dashboardSelectedRooms.size === rooms.length}
              onChange={() => setDashboardSelectedRooms(dashboardSelectedRooms.size === rooms.length ? new Set() : new Set(rooms.map((room) => room.number)))}
            />
            <span>{dashboardSelectedRooms.size ? `${dashboardSelectedRooms.size} chambre${dashboardSelectedRooms.size > 1 ? "s" : ""} sélectionnée${dashboardSelectedRooms.size > 1 ? "s" : ""}` : "Sélection multiple"}</span>
          </label>
          <div className="bulk-status-actions">
            <span>Passer la sélection en</span>
            <button className="bulk-status blank" disabled={!dashboardSelectedRooms.size} onClick={() => applyBulkIntervention("À blanc")}>À blanc</button>
            <button className="bulk-status stayover" disabled={!dashboardSelectedRooms.size} onClick={() => applyBulkIntervention("Recouche")}>Recouche</button>
            <button className="bulk-status free" disabled={!dashboardSelectedRooms.size} onClick={() => applyBulkIntervention("Libre")}>Libre</button>
            <span className="bulk-separator" aria-hidden="true" />
            <button className="bulk-status hs" disabled={!dashboardSelectedRooms.size} onClick={() => applyBulkOutOfService(true)}>Mettre HS</button>
            <button className="bulk-status in-service" disabled={!dashboardSelectedRooms.size} onClick={() => applyBulkOutOfService(false)}>Retirer HS</button>
            {Boolean(dashboardSelectedRooms.size) && <button className="bulk-clear" onClick={() => setDashboardSelectedRooms(new Set())}><X size={15} /> Annuler</button>}
          </div>
        </section>

        <section className="prep-summary" aria-label="Synthèse de la préparation">
          <article className="prep-metric blank"><span>À blanc</span><strong>{prepStats.blanks}</strong><small>{prepStats.blanks * blankMinutes} min théoriques</small></article>
          <article className="prep-metric stayover"><span>Recouches</span><strong>{prepStats.stayovers}</strong><small>{prepStats.stayovers * stayoverMinutes} min théoriques</small></article>
          <article className="prep-metric free"><span>Libres</span><strong>{prepStats.free}</strong><small>Aucune intervention</small></article>
          <article className={`prep-metric hs ${prepStats.outOfService ? "needs-attention" : ""}`}><span>Hors service</span><strong>{prepStats.outOfService}</strong><small>Statut indépendant du ménage</small></article>
          <article className={`prep-metric pending ${prepStats.unclassified ? "needs-attention" : "complete"}`}><span>À renseigner</span><strong>{prepStats.unclassified}</strong><small>{classified} / {rooms.length} classées</small></article>
          <article className={`prep-metric control ${prepStats.remainingToControl ? "needs-attention" : "complete"}`}><span>Restant à contrôler</span><strong>{prepStats.remainingToControl}</strong><small>{prepStats.serviceRooms - prepStats.remainingToControl} / {prepStats.serviceRooms} contrôlées</small></article>
          <article className="prep-workload">
            <div><span>À distribuer</span><strong>{prepStats.serviceRooms} chambres</strong></div>
            <div><span>Charge théorique</span><strong>{minutesToHours(prepStats.workloadMinutes)}</strong></div>
            <div className="prep-progress"><span style={{ width: `${(classified / rooms.length) * 100}%` }} /></div>
          </article>
        </section>

        <section className="floor-grid" aria-label="Tableau des 90 chambres">
          {floors.map((floor) => {
            const floorRooms = rooms.filter((room) => room.number.startsWith(floor));
            const floorClassified = floorRooms.filter((room) => room.intervention !== null).length;
            const floorBlanks = floorRooms.filter((room) => room.intervention === "À blanc").length;
            const floorStayovers = floorRooms.filter((room) => room.intervention === "Recouche").length;
            const floorOutOfService = floorRooms.filter((room) => room.outOfService).length;
            return (
              <article className="floor-card" key={floor}>
                <header className="floor-card-header">
                  <div className="floor-heading">
                    <span>{floor === "1" ? "1er" : `${floor}e`} étage</span>
                    <strong>{floorRooms.length} chambres</strong>
                    <div className="floor-status-counts" aria-label={`Synthèse du ${floor}e étage`}>
                      <b className="blank">{floorBlanks} blanc{floorBlanks > 1 ? "s" : ""}</b>
                      <b className="stayover">{floorStayovers} rec.</b>
                      <b className="hs">{floorOutOfService} HS</b>
                    </div>
                  </div>
                  <div className="floor-header-tools">
                    <label title={`Sélectionner tout le ${floor}e étage`}><input type="checkbox" checked={floorRooms.every((room) => dashboardSelectedRooms.has(room.number))} onChange={() => toggleFloorSelection(floorRooms)} /><span>Tout sélectionner</span></label>
                    <small>{floorClassified} / {floorRooms.length} renseignées</small>
                  </div>
                </header>
                <div className="prep-room-header" aria-hidden="true"><span /><span>Ch.</span><span>Type</span><span>Disposition</span><span>Situation</span><span>Suivi</span><span /></div>
                <div className="prep-room-list">
                  {floorRooms.map((room) => (
                    <div className={`prep-room-row ${room.intervention ? "classified" : ""} ${room.outOfService ? "out-of-service" : ""} ${dashboardSelectedRooms.has(room.number) ? "bulk-selected" : ""}`} key={room.number}>
                      <input className="dashboard-room-checkbox" type="checkbox" checked={dashboardSelectedRooms.has(room.number)} onChange={() => toggleDashboardSelection(room.number)} aria-label={`Sélectionner la chambre ${room.number}`} />
                      <div className="room-number-cell">
                        <button className="room-number-button" onClick={() => setSelectedRoom(room.number)} aria-label={`Ouvrir la chambre ${room.number}`}>{room.number}</button>
                        {room.arrivalToday && <span className="arrival-badge" title="Arrivée prévue aujourd’hui"><CalendarDays size={8} /> Arrivée</span>}
                      </div>
                      <span className="room-type" title={room.category}>{room.category}</span>
                      <span className={`room-layout ${room.layout !== room.defaultLayout ? "changed" : ""}`}>{room.layout}</span>
                      <div className="prep-choice-group" role="group" aria-label={`Situation de la chambre ${room.number}`}>
                        <button className={`prep-choice blank ${room.intervention === "À blanc" ? "active" : ""}`} aria-pressed={room.intervention === "À blanc"} onClick={() => setIntervention(room.number, "À blanc")} title={`À blanc · ${blankMinutes} minutes`}>Blanc</button>
                        <button className={`prep-choice stayover ${room.intervention === "Recouche" ? "active" : ""}`} aria-pressed={room.intervention === "Recouche"} onClick={() => setIntervention(room.number, "Recouche")} title={`Recouche · ${stayoverMinutes} minutes`}>Rec.</button>
                        <button className={`prep-choice free ${room.intervention === "Libre" ? "active" : ""}`} aria-pressed={room.intervention === "Libre"} onClick={() => setIntervention(room.number, "Libre")} title="Libre · aucune intervention">Libre</button>
                        <button className={`prep-choice hs ${room.outOfService ? "active" : ""}`} aria-pressed={room.outOfService} onClick={() => toggleOutOfService(room)} title={room.outOfService ? "Retirer le statut hors service" : "Mettre la chambre hors service"}>HS</button>
                      </div>
                      <div className="room-follow-up">
                        {(room.progress === "Contrôlée" || room.progress === "Validée sans contrôle") && <span className={`controlled-chip ${room.progress === "Validée sans contrôle" ? "exception" : ""}`} title={room.progress}><CheckCircle2 size={13} />{room.progress === "Contrôlée" ? "Contrôlée" : "Validée"}</span>}
                        {room.alert === "Problème technique" && <span className="technical-indicator" title={`Problème technique · ${room.technicalStatus ?? "Détecté"}`}><Wrench size={15} /></span>}
                      </div>
                      <button className={`room-note-button ${housekeeperInstruction(room) || room.floorComment || room.alert || room.technicalStatus === "Réparé" ? "has-note" : ""}`} onClick={() => setSelectedRoom(room.number)} aria-label={`Consignes et commentaires de la chambre ${room.number}`}><MessageSquareText size={15} /></button>
                      {(room.intervention === "À blanc" || room.intervention === "Recouche") && (
                        <div className="room-operation-row">
                          {room.intervention === "À blanc" && (
                            <div className="departure-control">
                              <span>Client</span>
                              <div role="group" aria-label={`Présence du client en chambre ${room.number}`}>
                                {(["Présent", "Parti"] as DepartureState[]).map((state) => (
                                  <button
                                    key={state}
                                    className={room.departureState === state ? "active" : ""}
                                    aria-pressed={room.departureState === state}
                                    onClick={() => updateDepartureState(room, state)}
                                  >{state}</button>
                                ))}
                              </div>
                            </div>
                          )}
                          <label className={`dashboard-assignee ${!room.housekeeper ? "needs-assignment" : ""}`}>
                            <span>Attribuée à</span>
                            <select value={room.housekeeper} onChange={(event) => updateRoom(room.number, { housekeeper: event.target.value })} aria-label={`Attribuer la chambre ${room.number}`}>
                              <option value="">À attribuer</option>
                              {presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      </>
    );
  };

  const renderDistribution = () => {
    const distributableRooms = rooms.filter((room) => room.intervention === "À blanc" || room.intervention === "Recouche");
    const visibleDistributableRooms = distributableRooms.filter((room) => {
      const matchesIntervention = distributionInterventionFilter === "all"
        || (distributionInterventionFilter === "blank" && room.intervention === "À blanc")
        || (distributionInterventionFilter === "stayover" && room.intervention === "Recouche");
      const matchesAssignee = distributionAssigneeFilter === "all"
        || (distributionAssigneeFilter === "unassigned" && !room.housekeeper)
        || room.housekeeper === distributionAssigneeFilter;
      return matchesIntervention && matchesAssignee;
    });
    const visibleRoomNumbers = new Set(visibleDistributableRooms.map((room) => room.number));
    const visibleSelectedRooms = new Set(Array.from(selectedRooms).filter((number) => visibleRoomNumbers.has(number)));
    const allVisibleSelected = Boolean(visibleDistributableRooms.length)
      && visibleDistributableRooms.every((room) => selectedRooms.has(room.number));
    const unassignedCount = distributableRooms.filter((room) => !room.housekeeper).length;
    const idealFor = (employee: Employee) => {
      const available = Math.max(0, employee.presenceMinutes - employee.pause - employeeAnnexMinutes(employee, commonAreas));
      const targetMinutes = totalAvailableMinutes ? prepStats.workloadMinutes * available / totalAvailableMinutes : 0;
      return { available, targetMinutes, targetRooms: targetMinutes ? Math.round(targetMinutes / averageRoomMinutes) : 0 };
    };
    const phoneEmployeeRecord = employees.find((employee) => employee.name === phoneEmployee);
    const phoneEmployeeRooms = rooms.filter((room) => room.housekeeper === phoneEmployee);
    const phoneCommonTasks = phoneEmployeeRecord ? employeeCommonAreaTasks(phoneEmployeeRecord, commonAreas) : [];
    const phoneBlankRooms = phoneEmployeeRooms.filter((room) => room.intervention === "À blanc");
    const phoneStayoverRooms = phoneEmployeeRooms.filter((room) => room.intervention === "Recouche");

    if (distributionStep === "team") {
      const capacityRate = totalAvailableMinutes ? Math.round((prepStats.workloadMinutes / totalAvailableMinutes) * 100) : 0;
      return (
        <>
          <section className="workflow-steps" aria-label="Étapes de préparation">
            <button onClick={() => setPage("dashboard")}><span><Check size={14} /></span><div><small>Étape 1</small><strong>Chambres</strong></div></button>
            <button className="active"><span>2</span><div><small>Étape 2</small><strong>Équipe du jour</strong></div></button>
            <button onClick={() => setDistributionStep("assign")}><span>3</span><div><small>Étape 3</small><strong>Distribution</strong></div></button>
          </section>

          <section className="section-heading team-heading">
            <div>
              <p className="eyebrow">Équipe du {shortDateLabel(workDate)}</p>
              <h2>Qui travaille aujourd’hui ?</h2>
              <p>Les horaires viennent du référentiel. Tu peux les corriger, modifier la pause et ajouter les tâches annexes du jour.</p>
            </div>
            <button className="button primary" onClick={() => {
              if (!presentEmployees.length) {
                showToast("Sélectionne au moins une femme de chambre");
                return;
              }
              setAssignTarget(presentEmployees[0].name);
              setPhoneEmployee(presentEmployees[0].name);
              setDistributionStep("assign");
            }}>Passer à la distribution <ChevronRight size={18} /></button>
          </section>

          <section className="team-day-summary">
            <article><span>Chambres à distribuer</span><strong>{prepStats.serviceRooms}</strong><small>{prepStats.blanks} à blanc · {prepStats.stayovers} recouches</small></article>
            <article><span>Charge théorique</span><strong>{minutesToHours(prepStats.workloadMinutes)}</strong><small>{blankMinutes} min / {stayoverMinutes} min</small></article>
            <article><span>Équipe présente</span><strong>{presentEmployees.length}</strong><small>{minutesToHours(totalAvailableMinutes)} disponibles pour les chambres</small></article>
            <article className={capacityRate > 100 ? "capacity-alert" : ""}><span>Taux de charge prévu</span><strong>{capacityRate} %</strong><small>{capacityRate > 100 ? "Capacité théorique dépassée" : "Répartition proportionnelle proposée"}</small></article>
          </section>

          <section className="team-planning-grid">
            {employees.filter((employee) => employee.active).map((employee) => {
              const ideal = idealFor(employee);
              return (
                <article className={`team-planning-card ${employee.presentToday ? "present" : "absent"}`} key={employee.id}>
                  <header>
                    <button className="employee-edit-link" onClick={() => openEmployeeEditFromDistribution(employee)} aria-label={`Modifier la fiche de ${employeeFullName(employee)}`}>
                      <span className="avatar large">{employee.name.slice(0, 1)}</span>
                      <span><strong>{employeeFullName(employee)}</strong><small>{employee.contract === "Extra" ? "Extra · horaires à saisir" : `Contrat ${employee.contract}`}</small></span>
                    </button>
                    <button className={`presence-toggle ${employee.presentToday ? "on" : "off"}`} aria-pressed={employee.presentToday} onClick={() => togglePresence(employee)}>{employee.presentToday ? <><Check size={14} /> Présente</> : <>Absente</>}</button>
                  </header>
                  <div className="team-form-row">
                    <label>Début<input type="time" value={employee.start} disabled={!employee.presentToday} onChange={(event) => updateEmployeeSchedule(employee, "start", event.target.value)} /></label>
                    <label>Fin<input type="time" value={employee.end} disabled={!employee.presentToday} onChange={(event) => updateEmployeeSchedule(employee, "end", event.target.value)} /></label>
                    <label>Pause<select value={employee.pause} disabled={!employee.presentToday} onChange={(event) => updateEmployee(employee.id, { pause: Number(event.target.value) })}>{[20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}</select></label>
                  </div>
                  <div className="annex-editor">
                    <div className="annex-editor-heading">
                      <span>Tâches annexes</span>
                      <button type="button" disabled={!employee.presentToday} onClick={() => addAnnexTask(employee)}><Plus size={13} /> Ajouter une tâche</button>
                    </div>
                    {employee.annexTasks.length ? (
                      <div className="annex-task-list">
                        {employee.annexTasks.map((task, index) => (
                          <div className="annex-task-row" key={task.id}>
                            <label>Tâche {index + 1}<input value={task.label} disabled={!employee.presentToday} onChange={(event) => updateAnnexTask(employee, task.id, { label: event.target.value })} placeholder="Ex. parties communes" /></label>
                            <label>Durée<div className="annex-duration-input"><input type="number" min="0" step="5" value={task.minutes} disabled={!employee.presentToday} onChange={(event) => updateAnnexTask(employee, task.id, { minutes: Math.max(0, Number(event.target.value)) })} /><span>min</span></div></label>
                            <button type="button" className="annex-remove" disabled={!employee.presentToday} onClick={() => removeAnnexTask(employee, task.id)} aria-label={`Supprimer la tâche ${index + 1}`}><Trash2 size={15} /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="annex-empty">Aucune tâche annexe prévue aujourd’hui.</p>}
                  </div>
                  <footer>
                    <div><small>Temps net chambres</small><strong>{employee.presentToday ? minutesToHours(ideal.available) : "—"}</strong></div>
                    <div className="ideal-target"><small>Cible conseillée</small><strong>{employee.presentToday ? `${ideal.targetRooms} chambres` : "—"}</strong><span>{employee.presentToday ? `≈ ${minutesToHours(Math.round(ideal.targetMinutes))}` : "Non comptabilisée"}</span></div>
                  </footer>
                </article>
              );
            })}
          </section>
          <div className="calculation-explainer"><CircleAlert size={17} /><p>La cible de chambres tient compte du temps laissé par les tâches annexes. À l’étape suivante, l’équité compare la charge totale de chacune : chambres + toutes les tâches annexes.</p></div>
        </>
      );
    }

    return (
      <>
        <section className="workflow-steps" aria-label="Étapes de préparation">
          <button onClick={() => setPage("dashboard")}><span><Check size={14} /></span><div><small>Étape 1</small><strong>Chambres</strong></div></button>
          <button onClick={() => setDistributionStep("team")}><span><Check size={14} /></span><div><small>Étape 2</small><strong>Équipe du jour</strong></div></button>
          <button className="active"><span>3</span><div><small>Étape 3</small><strong>Distribution</strong></div></button>
        </section>
        <section className="section-heading distribution-heading">
          <div>
            <p className="eyebrow">Feuille du {shortDateLabel(workDate)}</p>
            <h2>Distribuer les {prepStats.serviceRooms} chambres</h2>
            <p>Les cibles sont indicatives. Sélectionne une ou plusieurs chambres, puis attribue-les librement.</p>
          </div>
          <div className="heading-actions">
            <button className="button secondary" onClick={() => setDistributionStep("team")}><UsersRound size={18} /> Modifier l’équipe</button>
            <button className="button secondary" onClick={() => setShowPhone((value) => !value)}><Smartphone size={18} /> Aperçu femme de chambre</button>
            <button className="button primary" onClick={() => unassignedCount ? showToast(`Il reste ${unassignedCount} chambre${unassignedCount > 1 ? "s" : ""} à attribuer`) : setShowPublish(true)}><Send size={18} /> Publier la distribution</button>
          </div>
        </section>

        {distributionAlerts.length > 0 && (
          <section className="distribution-alert-stack" aria-label="Alertes de distribution">
            {distributionAlerts.map((alert) => (
              <article className={`distribution-alert ${alert.kind}`} key={alert.id}>
                <span className="distribution-alert-icon">{alert.kind === "floors" ? <Hotel size={19} /> : alert.kind === "overrun" ? <Clock3 size={19} /> : <TriangleAlert size={19} />}</span>
                <div><strong>{alert.title}</strong><p>{alert.detail}</p></div>
              </article>
            ))}
          </section>
        )}

        <section className="workload-grid">
          {presentEmployees.map((employee) => {
            const assigned = rooms.filter((room) => room.housekeeper === employee.name);
            const assignedBlanks = assigned.filter((room) => room.intervention === "À blanc").length;
            const assignedStayovers = assigned.filter((room) => room.intervention === "Recouche").length;
            const theoretical = assigned.reduce((total, room) => total + (room.intervention === "À blanc" ? blankMinutes : stayoverMinutes), 0);
            const annexMinutes = employeeAnnexMinutes(employee, commonAreas);
            const totalCharge = theoretical + annexMinutes;
            const netDay = Math.max(0, employee.presenceMinutes - employee.pause);
            const ideal = idealFor(employee);
            const load = Math.min(100, Math.round((totalCharge / Math.max(netDay, 1)) * 100));
            const employeeAlerts = distributionAlerts.filter((alert) => alert.employeeNames.includes(employee.name));
            return (
              <article className={`workload-card ${totalCharge > netDay ? "over-target" : ""} ${employeeAlerts.length ? "has-alert" : ""}`} key={employee.id}>
                <button className="workload-person-link" onClick={() => openEmployeeEditFromDistribution(employee)} aria-label={`Modifier la fiche de ${employeeFullName(employee)}`}><span className="avatar large">{employee.name.slice(0, 1)}</span><span><strong>{employeeFullName(employee)}</strong><small>Cible : {ideal.targetRooms} chambres · {minutesToHours(Math.round(ideal.targetMinutes))}</small></span></button>
                <div className="workload-numbers"><span><strong>{assigned.length}</strong> attribuées</span><span><strong>{minutesToHours(totalCharge)}</strong> de charge totale</span></div>
                <div className="workload-room-types"><span className="blank"><strong>{assignedBlanks}</strong> à blanc</span><span className="stayover"><strong>{assignedStayovers}</strong> recouches</span></div>
                <div className="load-bar"><span style={{ width: `${Math.max(load, 8)}%` }} /></div>
                <div className="task-line"><Sparkles size={15} /><span>{employee.annexTasks.length ? `${employee.annexTasks.length} tâche${employee.annexTasks.length > 1 ? "s" : ""} annexe${employee.annexTasks.length > 1 ? "s" : ""}` : "Aucune tâche annexe"}</span><small>{annexMinutes ? `${annexMinutes} min` : "—"}</small></div>
                {employeeAlerts.length > 0 && <div className="workload-card-alerts">{employeeAlerts.map((alert) => <span className={alert.kind} key={alert.id}>{alert.kind === "floors" ? "3 étages" : alert.kind === "overrun" ? "Dépassement" : "Équité"}</span>)}</div>}
              </article>
            );
          })}
        </section>

        <section className="distribution-layout">
          <div className="table-card assignment-card">
            <div className="card-title-row">
              <div><h3>Chambres à distribuer</h3><p>{visibleSelectedRooms.size ? `${visibleSelectedRooms.size} sélectionnée${visibleSelectedRooms.size > 1 ? "s" : ""}` : `${visibleDistributableRooms.length} affichée${visibleDistributableRooms.length > 1 ? "s" : ""} · ${unassignedCount} non attribuée${unassignedCount > 1 ? "s" : ""}`}</p></div>
              <div className="assign-box">
                <select value={assignTarget} onChange={(event) => setAssignTarget(event.target.value)} aria-label="Attribuer à">
                  {presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}
                </select>
                <button className="button compact primary" onClick={() => assignSelected(visibleSelectedRooms)} disabled={!presentEmployees.length || !visibleSelectedRooms.size}>Attribuer</button>
              </div>
            </div>
            <div className="distribution-filters" aria-label="Filtres de distribution">
              <label>
                <span>Intervention</span>
                <select value={distributionInterventionFilter} onChange={(event) => {
                  setDistributionInterventionFilter(event.target.value as DistributionInterventionFilter);
                  setSelectedRooms(new Set());
                }}>
                  <option value="all">Toutes</option>
                  <option value="stayover">Recouches</option>
                  <option value="blank">À blanc</option>
                </select>
              </label>
              <label>
                <span>Attribution</span>
                <select value={distributionAssigneeFilter} onChange={(event) => {
                  setDistributionAssigneeFilter(event.target.value);
                  setSelectedRooms(new Set());
                }}>
                  <option value="all">Toutes les attributions</option>
                  <option value="unassigned">Non attribuées</option>
                  {presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}
                </select>
              </label>
              {(distributionInterventionFilter !== "all" || distributionAssigneeFilter !== "all") && (
                <button type="button" className="button compact secondary" onClick={() => {
                  setDistributionInterventionFilter("all");
                  setDistributionAssigneeFilter("all");
                  setSelectedRooms(new Set());
                }}>Effacer les filtres</button>
              )}
            </div>
            <div className="table-scroll distribution-table-scroll">
              <table className="room-table assignment-table">
                <thead><tr><th aria-label="Sélection"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedRooms((current) => {
                  const next = new Set(current);
                  if (allVisibleSelected) visibleDistributableRooms.forEach((room) => next.delete(room.number));
                  else visibleDistributableRooms.forEach((room) => next.add(room.number));
                  return next;
                })} aria-label="Sélectionner toutes les chambres affichées" /></th><th>Chambre</th><th>Type</th><th>Disposition</th><th>Intervention</th><th>Attribuée à</th><th>Consigne</th></tr></thead>
                <tbody>
                  {visibleDistributableRooms.map((room) => (
                    <tr key={room.number} className={selectedRooms.has(room.number) ? "row-selected" : ""}>
                      <td><input type="checkbox" checked={selectedRooms.has(room.number)} onChange={() => toggleSelection(room.number)} aria-label={`Sélectionner la chambre ${room.number}`} /></td>
                      <td><strong>{room.number}</strong></td>
                      <td>{room.category}</td>
                      <td>
                        <select className={`layout-select ${room.layout !== room.defaultLayout ? "changed" : ""}`} value={room.layout} onChange={(event) => changeRoomLayout(room, event.target.value)} aria-label={`Disposition de la chambre ${room.number}`}>
                          {availableLayouts(room).map((layout) => <option key={layout}>{layout}</option>)}
                        </select>
                      </td>
                      <td><span className={`intervention-badge ${room.intervention === "À blanc" ? "blank" : "stayover"}`}>{room.intervention}</span></td>
                      <td>
                        <select value={room.housekeeper} onChange={(event) => updateRoom(room.number, { housekeeper: event.target.value })} aria-label={`Femme de chambre pour ${room.number}`}>
                          <option value="">Non attribuée</option>
                          {presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}
                        </select>
                      </td>
                      <td className={`comment-cell ${layoutChangeInstruction(room) ? "automatic-consigne" : ""}`}>{housekeeperInstruction(room) || "—"}</td>
                    </tr>
                  ))}
                  {!visibleDistributableRooms.length && <tr><td className="distribution-empty" colSpan={7}>Aucune chambre ne correspond à ces filtres.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {showPhone && (
            <aside className="phone-panel">
              <div className="phone-panel-heading"><div><span>Aperçu téléphone</span><select value={phoneEmployee} onChange={(event) => setPhoneEmployee(event.target.value)}>{presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}</select></div><button className="icon-button ghost" onClick={() => setShowPhone(false)} aria-label="Fermer"><X size={18} /></button></div>
              <div className="phone-frame">
                <div className="phone-status"><span>9:41</span><Wifi size={14} /></div>
                <div className="phone-brand"><img src={hotelLogo} alt={hotelName} /><span>{new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(safeDate(workDate))}</span></div>
                <div className="phone-greeting"><small>Bonjour</small><h3>{phoneEmployee}</h3><p>{phoneEmployeeRooms.length} chambres aujourd’hui · {phoneBlankRooms.length} à blanc · {phoneStayoverRooms.length} recouches</p></div>
                <div className="phone-task"><Sparkles size={17} /><div><small>Tâches annexes</small>{phoneEmployeeRecord && employeeAnnexMinutes(phoneEmployeeRecord, commonAreas) ? <strong>{employeeAnnexSummary(phoneEmployeeRecord, commonAreas)}</strong> : <strong>Aucune</strong>}</div></div>
                <div className="phone-list">
                {phoneCommonTasks.length > 0 && <div className="phone-common-tasks">
                  <header><strong>PARTIES COMMUNES</strong><span>{phoneCommonTasks.length}</span></header>
                  {phoneCommonTasks.map((area) => <article className={area.completed ? "completed" : ""} key={area.id}>
                    <div><strong>{area.name}</strong><span>{area.minutes} min</span></div>
                    <p>{area.comment || "Ménage demandé"}</p>
                    <button type="button" disabled={area.completed} onClick={() => {
                      setCommonAreas((current) => current.map((item) => item.id === area.id ? { ...item, completed: true } : item));
                      showToast(`${area.name} · ménage terminé`);
                    }}>{area.completed ? <><Check size={14} /> Terminé</> : "Déclarer terminé"}</button>
                  </article>)}
                </div>}
                  <section className="phone-room-section blank-section">
                    <header><strong>À BLANC</strong><span>{phoneBlankRooms.length}</span></header>
                    {phoneBlankRooms.length ? phoneBlankRooms.map((room) => (
                      <article key={room.number}>
                        <div><strong>{room.number}</strong><span className={`housekeeper-situation ${room.departureState === "Parti" ? "departed" : "present"}`}>{housekeeperSituation(room)}</span></div>
                        <strong className="housekeeper-intervention blank">À BLANC</strong>
                        <p>{room.category} · {room.layout}</p>
                        {housekeeperInstruction(room) && <small className="phone-consigne"><BellRing size={13} /><span><b>Consigne</b>{housekeeperInstruction(room)}</span></small>}
                      </article>
                    )) : <p className="phone-empty">Aucune chambre à blanc</p>}
                  </section>
                  <section className="phone-room-section stayover-section">
                    <header><strong>RECOUCHES</strong><span>{phoneStayoverRooms.length}</span></header>
                    {phoneStayoverRooms.length ? phoneStayoverRooms.map((room) => (
                      <article key={room.number}>
                        <div><strong>{room.number}</strong></div>
                        <strong className="housekeeper-intervention stayover">RECOUCHE</strong>
                        <p>{room.category} · {room.layout}</p>
                        {housekeeperInstruction(room) && <small className="phone-consigne"><BellRing size={13} /><span><b>Consigne</b>{housekeeperInstruction(room)}</span></small>}
                      </article>
                    )) : <p className="phone-empty">Aucune recouche</p>}
                  </section>
                </div>
                <div className="phone-readonly"><Eye size={14} /> Feuille en consultation uniquement</div>
              </div>
            </aside>
          )}
        </section>
      </>
    );
  };

  const renderPersonnel = () => {
    const activeEmployees = employees.filter((employee) => employee.active);
    const archivedEmployees = employees.filter((employee) => !employee.active);
    const visibleEmployees = (personnelView === "active" ? activeEmployees : archivedEmployees)
      .filter((employee) => employeeFullName(employee).toLocaleLowerCase("fr").includes(personnelSearch.trim().toLocaleLowerCase("fr")));
    return (
      <>
      <section className="section-heading">
        <div><p className="eyebrow">Équipe des étages</p><h2>{personnelView === "active" ? "Personnel actif" : "Personnel archivé"}</h2><p>{personnelView === "active" ? "Les horaires et pauses servent au calcul de charge ; la feuille de présence reste la référence." : "Les personnes archivées ne figurent plus dans l’équipe du jour ni dans les listes d’attribution."}</p></div>
        {personnelView === "active" && <button className="button primary" onClick={() => { setNewEmployee((current) => ({ ...current, pause: defaultPauseMinutes })); setShowAddEmployee(true); }}><UserPlus size={18} /> Ajouter une personne</button>}
      </section>
      <nav className="personnel-tabs" aria-label="Pages du personnel">
        <button className={personnelView === "active" ? "active" : ""} onClick={() => setPersonnelView("active")}><UsersRound size={17} /> Personnel actif <span>{activeEmployees.length}</span></button>
        <button className={personnelView === "archived" ? "active" : ""} onClick={() => setPersonnelView("archived")}><Archive size={17} /> Personnel archivé <span>{archivedEmployees.length}</span></button>
      </nav>
      <section className="table-card personnel-card">
        <div className="card-title-row"><div><h3>{personnelView === "active" ? "Référentiel permanent du personnel" : "Archives du personnel"}</h3><p>{personnelView === "active" ? "Identité, contrat, horaires habituels, pause et support de distribution." : "Réactive une personne pour la rendre de nouveau disponible."}</p></div><label className="search-field"><Search size={18} /><input placeholder="Rechercher" value={personnelSearch} onChange={(event) => setPersonnelSearch(event.target.value)} /></label></div>
        <div className="table-scroll">
          <table className="room-table personnel-table">
            <thead><tr><th>Prénom et nom</th><th>Contrat</th><th>Horaires habituels</th><th>Pause habituelle</th><th>Distribution</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td><span className="person-cell"><span className="avatar">{employee.name.slice(0, 1)}</span><span className="person-name"><strong>{employee.name}</strong><small>{employee.lastName || "Nom à renseigner"}</small></span></span></td>
                  <td>{employee.contract}</td>
                  <td><div className="personnel-hours"><input type="time" value={employee.start} disabled={!employee.active} onChange={(event) => updateEmployeeSchedule(employee, "start", event.target.value)} /><span>–</span><input type="time" value={employee.end} disabled={!employee.active} onChange={(event) => updateEmployeeSchedule(employee, "end", event.target.value)} /></div><small>{minutesToHours(employee.presenceMinutes)} retenues</small></td>
                  <td><select value={employee.pause} disabled={!employee.active} onChange={(event) => updateEmployee(employee.id, { pause: Number(event.target.value) })}>{[20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}</select></td>
                  <td><span className="delivery-label">{employee.delivery === "phone" ? <Smartphone size={16} /> : <Printer size={16} />}{employee.delivery === "phone" ? "Téléphone" : "PDF"}</span></td>
                  <td><span className={`active-badge ${employee.active ? "on" : "off"}`}>{employee.active ? "Active" : "Archivée"}</span></td>
                  <td><div className="personnel-actions"><button className="icon-button ghost" aria-label={`Modifier ${employeeFullName(employee)}`} title="Modifier" onClick={() => setEditingEmployee({ ...employee })}><Pencil size={17} /></button><button className="icon-button ghost" aria-label={employee.active ? `Archiver ${employeeFullName(employee)}` : `Réactiver ${employeeFullName(employee)}`} title={employee.active ? "Supprimer et archiver" : "Réactiver"} onClick={() => changeEmployeeArchiveState(employee, !employee.active)}>{employee.active ? <Archive size={18} /> : <Check size={18} />}</button></div></td>
                </tr>
              ))}
              {!visibleEmployees.length && <tr><td colSpan={7}><div className="empty-personnel"><Archive size={22} /><span>{personnelView === "archived" ? "Aucune personne archivée" : "Aucun résultat"}</span></div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      </>
    );
  };

  const renderReports = () => {
    const totalRooms = reportRows.reduce((total, row) => total + row.rooms, 0);
    const totalCharge = reportRows.reduce((total, row) => total + row.totalCharge, 0);
    const totalAvailable = reportRows.reduce((total, row) => total + row.available, 0);
    const totalNetDay = reportRows.reduce((total, row) => total + row.netDay, 0);
    return (
      <>
        <section className="section-heading report-heading">
          <div><p className="eyebrow">Journée clôturable</p><h2>Rapport du {shortDateLabel(workDate)}</h2><p>Calculé avec {blankMinutes} minutes par à blanc, {stayoverMinutes} minutes par recouche et les tâches annexes intégrées à la charge globale.</p></div>
          <div className="heading-actions"><label className="report-date-picker"><CalendarDays size={18} /><input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label><button className="button primary" onClick={generateReportPdf}><FileDown size={18} /> Générer le rapport PDF</button></div>
        </section>
        <section className="report-metrics">
          <article><span>Interventions attribuées</span><strong>{totalRooms}</strong><small>{reportRows.reduce((total, row) => total + row.blanks, 0)} à blanc · {reportRows.reduce((total, row) => total + row.stayovers, 0)} recouches</small></article>
          <article className="global-productivity-metric"><span>Productivité globale</span><strong>{totalAvailable ? (totalRooms / (totalAvailable / 60)).toFixed(2) : "0.00"} <em>ch/h</em></strong><small>Cadence de l’ensemble de l’équipe</small></article>
          <article><span>Taux de charge pondéré</span><strong>{totalNetDay ? Math.round((totalCharge / totalNetDay) * 100) : 0} %</strong><small>Chambres + tâches annexes</small></article>
          <article className="alert-metric"><span>Événements</span><strong>{dayEvents.length}</strong><small>{dayEvents.length ? "Repris dans le rapport PDF" : "Aucun événement déclaré"}</small></article>
        </section>
        <section className="report-layout">
          <div className="table-card report-table-card">
            <div className="card-title-row"><div><h3>Productivité individuelle</h3><p>Calculée sur le temps disponible après pause et tâches annexes.</p></div><span className="calculation-note"><CircleAlert size={15} /> Feuille de présence faisant foi</span></div>
            <div className="table-scroll">
              <table className="room-table report-table">
                <thead><tr><th>Femme de chambre</th><th>À blanc</th><th>Recouches</th><th>Total</th><th>Temps disponible</th><th>Cadence</th><th>Charge pondérée</th></tr></thead>
                <tbody>{reportRows.map((row) => <tr key={row.name}><td><span className="person-cell"><span className="avatar">{row.name[0]}</span><strong>{row.name}</strong></span></td><td>{row.blanks}</td><td>{row.stayovers}</td><td><strong>{row.rooms}</strong></td><td>{minutesToHours(row.available)}<small>{row.annexMinutes ? `${row.annexMinutes} min annexes déduites` : "Sans tâche annexe"}</small></td><td><strong>{row.cadence.toFixed(2)} ch/h</strong></td><td><div className="mini-progress"><span style={{ width: `${Math.min(row.load, 100)}%` }} /></div><strong>{Math.round(row.load)} %</strong></td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <aside className="events-card">
            <div className="events-title"><div><h3>Événements</h3><p>Repris dans le rapport PDF</p></div><span>{dayEvents.length}</span></div>
            {dayEvents.length ? <ol className="event-list">{dayEvents.map((room) => <li key={room.number}><span className={`event-icon ${room.technicalStatus ? "blue" : room.alert === "Refus de service" ? "amber" : "red"}`}>{room.technicalStatus ? <Wrench size={16} /> : <BellRing size={16} />}</span><div><strong>Chambre {room.number} · {roomEventLabel(room)}</strong><p>{room.floorComment ?? room.receptionComment ?? "Sans commentaire"}</p>{roomPhotoSource(room) && <img className="event-photo" src={roomPhotoSource(room)} alt={`Photo du problème en chambre ${room.number}`} />}<small>{room.technicalStatus === "Réparé" ? "Conservé dans le rapport après réparation" : "Synchronisé avec Raccotel Technique"}</small></div></li>)}</ol> : <div className="empty-events"><CheckCircle2 size={24} /><p>Aucun événement déclaré pour le moment.</p></div>}
            <label className={`report-comment-field ${reportCommentError ? "error" : ""}`}>
              <span>Commentaire de la gouvernante <b>obligatoire</b></span>
              <textarea value={reportComment} onChange={(event) => { setReportComment(event.target.value); if (event.target.value.trim()) setReportCommentError(false); }} placeholder="Événements de la journée ou RAS" />
              <small>{reportCommentError ? "Ajoute un commentaire avant de générer le rapport." : "Saisir « RAS » si rien n’est à signaler."}</small>
            </label>
          </aside>
        </section>
      </>
    );
  };

  const renderSettings = () => (
    <>
      <section className="section-heading"><div><p className="eyebrow">Configuration multi-hôtel</p><h2>Identité et règles de calcul</h2><p>Ces paramètres sont propres à chaque établissement et pourront être dupliqués.</p></div><button className="button primary" onClick={saveSettings}><Check size={18} /> Enregistrer</button></section>
      <section className="settings-grid">
        <article className="settings-card identity-card">
          <div className="settings-card-title"><Building2 size={20} /><div><h3>Établissement</h3><p>Identité affichée dans l’application et les PDF.</p></div></div>
          <div className="brand-preview">
            <div className="logo-config-card hotel-logo-light"><img src={hotelLogo} alt={`Logo ${hotelName}`} /><label className="logo-upload"><ImagePlus size={15} /> Remplacer le logo<input type="file" accept="image/*" onChange={(event) => uploadLogo(event, setHotelLogo)} /></label></div>
            <div className="logo-config-card sowell-logo-card"><img src={groupLogo} alt={`Logo ${groupName}`} /><label className="logo-upload"><ImagePlus size={15} /> Remplacer le logo<input type="file" accept="image/*" onChange={(event) => uploadLogo(event, setGroupLogo)} /></label></div>
          </div>
          <label>Nom de l’établissement<input value={hotelName} onChange={(event) => setHotelName(event.target.value)} /></label>
          <label>Groupe ou seconde identité<input value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label>
          <label>Adresse<input value={hotelAddress} onChange={(event) => setHotelAddress(event.target.value)} /></label>
        </article>
        <article className="settings-card">
          <div className="settings-card-title"><Clock3 size={20} /><div><h3>Temps et productivité</h3><p>Valeurs par défaut modifiables au quotidien.</p></div></div>
          <div className="setting-row"><div><strong>Chambre à blanc</strong><small>Temps théorique moyen</small></div><select value={blankMinutes} onChange={(event) => setBlankMinutes(Number(event.target.value))}>{[15, 20, 25, 30, 35, 40].map((value) => <option key={value} value={value}>{value} min</option>)}</select></div>
          <div className="setting-row"><div><strong>Recouche</strong><small>Temps théorique moyen</small></div><select value={stayoverMinutes} onChange={(event) => setStayoverMinutes(Number(event.target.value))}>{[15, 20, 25, 30, 35, 40].map((value) => <option key={value} value={value}>{value} min</option>)}</select></div>
          <div className="setting-row"><div><strong>Pause par défaut</strong><small>Déduite du temps de présence ; modifiable pour chaque personne</small></div><select value={defaultPauseMinutes} onChange={(event) => setDefaultPauseMinutes(Number(event.target.value))}>{[20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}</select></div>
          <div className="setting-row"><div><strong>Source des heures</strong><small>Donnée officielle</small></div><span className="locked-value"><ShieldCheck size={16} /> Feuille de présence</span></div>
        </article>
        <article className="settings-card alert-settings-card">
          <div className="settings-card-title"><BellRing size={20} /><div><h3>Alertes de distribution</h3><p>Chaque contrôle peut être activé ou désactivé indépendamment.</p></div></div>
          <div className="alert-toggle-list">
            <div className="alert-toggle-row"><span><strong>Alerte équité</strong><small>Écart manifeste de charge à temps disponible égalisé.</small></span><button type="button" role="switch" aria-checked={alertSettings.equity} className={alertSettings.equity ? "on" : ""} onClick={() => toggleAlertSetting("equity")}><span /></button></div>
            <div className="alert-toggle-row"><span><strong>Alerte 3 étages</strong><small>Une même personne reçoit des chambres sur au moins trois étages.</small></span><button type="button" role="switch" aria-checked={alertSettings.floors} className={alertSettings.floors ? "on" : ""} onClick={() => toggleAlertSetting("floors")}><span /></button></div>
            <div className="alert-toggle-row"><span><strong>Alerte dépassement</strong><small>Chambres et tâches annexes dépassent le temps net du jour, pause déduite.</small></span><button type="button" role="switch" aria-checked={alertSettings.overrun} className={alertSettings.overrun ? "on" : ""} onClick={() => toggleAlertSetting("overrun")}><span /></button></div>
          </div>
        </article>
        <article className="settings-card">
          <div className="settings-card-title"><Hotel size={20} /><div><h3>Référentiel chambres</h3><p>{rooms.length} chambres et {Object.keys(categoryCounts).length} typologies configurées.</p></div></div>
          <div className="room-category-grid">{Object.entries(layoutCounts).map(([layout, count]) => <span key={layout}><strong>{count}</strong> {layout}</span>)}</div>
          <div className="room-type-tags" aria-label="Typologies de chambres">{Object.entries(categoryCounts).map(([category, count]) => <span key={category}>{category} · {count}</span>)}</div>
          <button className="button secondary full" onClick={openRoomSettings}><Pencil size={17} /> Configurer les chambres et typologies</button>
        </article>
        <article className="settings-card common-area-settings-card">
          <div className="settings-card-title"><Building2 size={20} /><div><h3>Parties communes partagées</h3><p>Référentiel unique pour Housekeeping et Technique.</p></div></div>
          <div className="common-area-settings-list">
            {commonAreas.map((area, index) => (
              <div className={`common-area-setting-row ${area.active === false ? "archived" : ""}`} key={area.id}>
                <input defaultValue={area.name} disabled={area.active === false} onBlur={(event) => renameCommonAreaSetting(area, event.target.value)} aria-label={`Nom de la partie commune ${index + 1}`} />
                <div className="common-area-order-buttons">
                  <button type="button" disabled={index === 0} onClick={() => moveCommonAreaSetting(area.id, -1)} aria-label={`Remonter ${area.name}`}>↑</button>
                  <button type="button" disabled={index === commonAreas.length - 1} onClick={() => moveCommonAreaSetting(area.id, 1)} aria-label={`Descendre ${area.name}`}>↓</button>
                </div>
                <button type="button" className="common-area-archive-button" onClick={() => toggleCommonAreaArchive(area)} aria-label={area.active === false ? `Réactiver ${area.name}` : `Archiver ${area.name}`}>{area.active === false ? <Check size={15} /> : <Archive size={15} />}</button>
              </div>
            ))}
          </div>
          <div className="common-area-add-row">
            <input value={newCommonAreaName} onChange={(event) => setNewCommonAreaName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addCommonAreaSetting(); }} placeholder="Nouvelle partie commune" />
            <button type="button" onClick={addCommonAreaSetting} disabled={!newCommonAreaName.trim()}><Plus size={14} /> Ajouter</button>
          </div>
          <small className="settings-help">Les zones archivées restent dans l’historique mais ne sont plus proposées au quotidien.</small>
        </article>
        <article className="settings-card">
          <div className="settings-card-title"><MessageSquareText size={20} /><div><h3>Consignes prédéfinies</h3><p>Ajoutables en un geste par la réception.</p></div></div>
          <div className="instruction-settings-list">
            {predefinedInstructions.map((instruction, index) => (
              <div className="instruction-setting-row" key={index}>
                <input
                  value={instruction}
                  onChange={(event) => updatePredefinedInstruction(index, event.target.value)}
                  onBlur={() => instruction.trim() ? updatePredefinedInstruction(index, instruction.trim()) : removePredefinedInstruction(index)}
                  aria-label={`Modifier la consigne ${index + 1}`}
                />
                <button type="button" onClick={() => removePredefinedInstruction(index)} aria-label={`Supprimer la consigne ${instruction || index + 1}`}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="instruction-add-row">
            <input value={newPredefinedInstruction} onChange={(event) => setNewPredefinedInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addPredefinedInstructionSetting(); }} placeholder="Nouvelle consigne" aria-label="Nouvelle consigne prédéfinie" />
            <button type="button" onClick={addPredefinedInstructionSetting} disabled={!newPredefinedInstruction.trim()}><Plus size={14} /> Ajouter</button>
          </div>
          <hr />
          <label className="language-row"><span><strong>Langues des feuilles</strong><small>Interface gouvernante en français</small></span><select defaultValue="fr-es"><option value="fr-es">Français + espagnol</option><option value="fr">Français</option></select></label>
        </article>
        <article className="settings-card accounts-card">
          <div className="settings-card-title"><UsersRound size={20} /><div><h3>Comptes utilisateurs</h3><p>Un compte distinct pour chaque fonction autorisée dans l’hôtel.</p></div></div>
          <div className="account-settings-list">
            {accounts.map((account) => (
              <div className={`account-setting-row ${account.active ? "" : "archived"}`} key={account.id}>
                <span className="avatar">{accountInitials(account.name)}</span>
                <div className="account-identity-fields"><input value={account.name} disabled={!account.active} onChange={(event) => updateAccount(account.id, { name: event.target.value })} onBlur={() => saveCloudAccount(account)} aria-label={`Nom du compte ${account.name}`} /><input type="email" value={account.email ?? ""} disabled={!account.active || Boolean(account.userId)} onChange={(event) => updateAccount(account.id, { email: event.target.value })} onBlur={() => saveCloudAccount(account)} placeholder="adresse@hotel.fr" aria-label={`E-mail du compte ${account.name}`} /></div>
                <select value={account.role} disabled={!account.active || account.email?.toLowerCase() === cloudContext?.email.toLowerCase() || (!cloudContext && account.id === currentAccountId)} onChange={(event) => { const role = event.target.value as AccountRole; updateAccount(account.id, { role }); void saveCloudAccount({ ...account, role }); }} aria-label={`Rôle du compte ${account.name}`} title={account.email?.toLowerCase() === cloudContext?.email.toLowerCase() || (!cloudContext && account.id === currentAccountId) ? "Le rôle du compte actuellement connecté ne peut pas être modifié" : undefined}>
                  {accountRoles.map((role) => <option key={role}>{role}</option>)}
                </select>
                <button className="icon-button ghost" onClick={() => toggleAccount(account)} title={account.active ? "Archiver le compte" : "Réactiver le compte"} aria-label={account.active ? `Archiver ${account.name}` : `Réactiver ${account.name}`}>{account.active ? <Archive size={16} /> : <Check size={16} />}</button>
              </div>
            ))}
          </div>
          <div className="account-add-row">
            <input value={newAccountName} onChange={(event) => setNewAccountName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addAccount(); }} placeholder="Nom du nouveau compte" aria-label="Nom du nouveau compte" />
            <input type="email" value={newAccountEmail} onChange={(event) => setNewAccountEmail(event.target.value)} placeholder={cloudContext ? "adresse@hotel.fr" : "E-mail (facultatif)"} aria-label="Adresse e-mail du nouveau compte" />
            <select value={newAccountRole} onChange={(event) => setNewAccountRole(event.target.value as AccountRole)} aria-label="Rôle du nouveau compte">
              {accountRoles.map((role) => <option key={role}>{role}</option>)}
            </select>
            <button type="button" onClick={addAccount} disabled={!newAccountName.trim() || Boolean(cloudContext && !newAccountEmail.trim())}><Plus size={14} /> Ajouter</button>
          </div>
          {!cloudContext ? <div className="admin-password-setting">
            <label><span>Mot de passe administrateur</span><input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="new-password" /></label>
            <p><LockKeyhole size={14} /> Demandé pour ouvrir le compte administrateur et modifier les paramètres.</p>
          </div> : <p className="cloud-account-note"><Cloud size={15} /><span><strong>Comptes partagés actifs</strong>Chaque personne crée son mot de passe avec l’adresse autorisée ici. L’administrateur reste le seul à pouvoir modifier ces paramètres.</span></p>}
          <p className="account-security-note"><ShieldCheck size={14} /> Tous les rôles non administrateurs restent sans droit de modification sur les paramètres.</p>
        </article>
      </section>
    </>
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand-block">
          <img className="hotel-logo" src={hotelLogo} alt={hotelName} />
          <span className="brand-divider" />
          <img className="sowell-logo" src={groupLogo} alt={groupName} />
        </div>
        <nav aria-label="Navigation principale">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => { setPage(item.id); setMobileNav(false); }}><Icon size={20} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="raccoon-signature"><img src="/favicon-32.png" alt="" /><span>Raccotel Housekeeping</span></div>
          <button className={page === "settings" ? "active" : ""} onClick={openSettings}><Settings size={20} /><span>Paramètres</span>{!canManageSettings && <LockKeyhole className="settings-lock-icon" size={13} />}</button>
          <div className="user-menu-wrap">
            <button className="user-card" onClick={() => setShowAccountMenu((value) => !value)} aria-expanded={showAccountMenu} aria-label={cloudContext ? "Ouvrir le menu du compte" : "Changer de compte"}>
              <span className="avatar gold">{accountInitials(currentAccount.name)}</span><div><strong>{currentAccount.name}</strong><small>{currentAccount.role}</small></div><ChevronRight size={16} />
            </button>
            {showAccountMenu && (
              <div className="account-menu" role="menu">
                {cloudContext ? (
                  <>
                    <small>Compte connecté</small>
                    <button className="active" role="menuitem"><span className="avatar">{accountInitials(currentAccount.name)}</span><span><strong>{currentAccount.name}</strong><small>{currentAccount.email}</small></span><Check size={15} /></button>
                    {currentAccount.role === "Administrateur" && <button className="manage-accounts" onClick={openSettings}><Settings size={15} /> Gérer les comptes <LockKeyhole size={12} /></button>}
                    <button className="manage-accounts sign-out-button" onClick={signOutCloud}><LogOut size={15} /> Se déconnecter</button>
                  </>
                ) : (
                  <>
                    <small>Changer de compte</small>
                    {accounts.filter((account) => account.active).map((account) => <button key={account.id} className={account.id === currentAccountId ? "active" : ""} onClick={() => switchAccount(account)} role="menuitem"><span className="avatar">{accountInitials(account.name)}</span><span><strong>{account.name}</strong><small>{account.role}</small></span>{account.id === currentAccountId && <Check size={15} />}</button>)}
                    <button className="manage-accounts" onClick={openSettings}><Settings size={15} /> Gérer les comptes <LockKeyhole size={12} /></button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileNav((value) => !value)} aria-label="Ouvrir le menu"><Menu size={22} /></button>
          <div className="mobile-brand"><img src={hotelLogo} alt={hotelName} /></div>
          <div className="title-block"><p className="mobile-section-label">Gestion des étages</p><h1>{pageTitle}</h1>{page !== "dashboard" && <button className="hotel-switcher"><Hotel size={15} /> {hotelName} <ChevronDown size={14} /></button>}</div>
          <div className="date-block">
            <span className={`sync-pill sync-${syncStatus}`} title={lastSavedAt ? `Dernière sauvegarde à ${timeLabel(lastSavedAt)}` : undefined}>{syncPresentation.icon}{syncPresentation.label}</span>
            <CalendarDays size={21} />
            <label className="topbar-date-picker"><strong>{shortDateLabel(workDate)}</strong><small>{timeLabel(clock)}</small><input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} aria-label="Changer la journée affichée" /></label>
          </div>
        </header>

        <div className="page-content">
          {page === "dashboard" && renderDashboard()}
          {page === "distribution" && renderDistribution()}
          {page === "personnel" && renderPersonnel()}
          {page === "reports" && renderReports()}
          {page === "settings" && renderSettings()}
        </div>
      </main>

      {showAdminLogin && (
        <div className="modal-backdrop" onClick={() => setShowAdminLogin(false)}>
          <form className="modal small-modal admin-login-modal" onSubmit={(event) => { event.preventDefault(); submitAdminLogin(); }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">Accès protégé</p><h2>Compte administrateur</h2><p>Le mot de passe est nécessaire pour ouvrir ce compte et modifier les paramètres.</p></div><button type="button" className="icon-button ghost" onClick={() => setShowAdminLogin(false)} aria-label="Fermer"><X size={20} /></button></div>
            <div className="admin-login-content">
              <div className="admin-login-account"><span className="avatar gold">{accountInitials(accounts.find((account) => account.id === pendingAdminAccountId)?.name ?? "Admin")}</span><span><small>Compte</small><strong>{accounts.find((account) => account.id === pendingAdminAccountId)?.name ?? "Administrateur"}</strong></span></div>
              <label className={adminLoginError ? "error" : ""}><span>Mot de passe</span><input autoFocus type="password" value={adminLoginPassword} onChange={(event) => { setAdminLoginPassword(event.target.value); setAdminLoginError(false); }} autoComplete="current-password" placeholder="Saisir le mot de passe" />{adminLoginError && <small>Mot de passe incorrect.</small>}</label>
              {adminPassword === "admin" && <p className="demo-password-note"><CircleAlert size={14} /> Maquette : mot de passe de test « admin ».</p>}
            </div>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowAdminLogin(false)}>Annuler</button><button type="submit" className="button primary"><LockKeyhole size={17} /> Déverrouiller</button></div>
          </form>
        </div>
      )}

      {currentRoom && (
        <div className="drawer-backdrop" onClick={() => setSelectedRoom(null)}>
          <aside className="room-drawer" onClick={(event) => event.stopPropagation()} aria-label={`Détail de la chambre ${currentRoom.number}`}>
            <div className="drawer-header"><div><p>Chambre</p><h2>{currentRoom.number}</h2><span>{currentRoom.category} · {currentRoom.layout} · {currentRoom.intervention ?? "Non renseignée"}</span></div><button className="icon-button ghost" onClick={() => setSelectedRoom(null)} aria-label="Fermer"><X size={21} /></button></div>
            <div className="drawer-summary"><div><small>Statut Resalys</small><span className={`status-badge status-${currentRoom.status.toLowerCase()}`}>{currentRoom.status}</span><p>{statusLabels[currentRoom.status]}</p></div><div><small>Attribuée à</small>{currentRoom.intervention === "À blanc" || currentRoom.intervention === "Recouche" ? <select className={!currentRoom.housekeeper ? "needs-assignment" : ""} value={currentRoom.housekeeper} onChange={(event) => updateRoom(currentRoom.number, { housekeeper: event.target.value })}><option value="">À attribuer</option>{presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}</select> : <span className="muted">Aucune intervention</span>}</div>{currentRoom.intervention === "À blanc" && <div className="drawer-departure"><small>Client</small><div className="departure-control"><div role="group" aria-label={`Présence du client en chambre ${currentRoom.number}`}>{(["Présent", "Parti"] as DepartureState[]).map((state) => <button key={state} className={currentRoom.departureState === state ? "active" : ""} onClick={() => updateDepartureState(currentRoom, state)}>{state}</button>)}</div></div></div>}<div className={`drawer-arrival ${currentRoom.arrivalToday ? "active" : ""}`}><small>Planning du jour</small><button type="button" aria-pressed={currentRoom.arrivalToday} onClick={() => updateRoom(currentRoom.number, { arrivalToday: !currentRoom.arrivalToday })}><CalendarDays size={16} />{currentRoom.arrivalToday ? "Arrivée prévue aujourd’hui" : "Aucune arrivée prévue"}</button></div></div>
            <section className="drawer-section"><div className="drawer-section-title"><h3>Avancement</h3><span>Mise à jour gouvernante</span></div><div className="progress-options">{(["À faire", "En cours", "Terminée", "Contrôlée"] as Progress[]).map((progress) => <button key={progress} className={currentRoom.progress === progress ? "selected" : ""} onClick={() => updateProgress(currentRoom, progress)}><span>{currentRoom.progress === progress ? <Check size={15} /> : null}</span>{progress}</button>)}</div><button className="text-button validation-button" onClick={() => updateProgress(currentRoom, "Validée sans contrôle")}><ShieldCheck size={16} /> Valider exceptionnellement sans contrôle</button></section>
            <section className="drawer-section instruction-section">
              <div className="drawer-section-title"><h3>Consigne femme de chambre</h3><span>Visible sur le téléphone et le PDF</span></div>
              {layoutChangeInstruction(currentRoom) && <div className="automatic-instruction"><CircleAlert size={15} /><span><strong>Consigne automatique</strong>{layoutChangeInstruction(currentRoom)}</span></div>}
              <div className="instruction-shortcuts">{predefinedInstructions.map((instruction) => <button key={instruction} className={(currentRoom.receptionComment ?? "").split(" · ").includes(instruction) ? "selected" : ""} onClick={() => addPredefinedInstruction(currentRoom, instruction)}><Plus size={13} />{instruction}</button>)}</div>
              <label><span>Consigne libre</span><textarea value={currentRoom.receptionComment ?? ""} onChange={(event) => updateRoom(currentRoom.number, { receptionComment: event.target.value })} placeholder="Ex. préparer un lit bébé, séparer les lits…" /></label>
            </section>
            <section className="drawer-section">
              <div className="drawer-section-title"><h3>Signalement</h3><span>Événement de la journée</span></div>
              <div className="incident-options">{(["DND", "Refus de service", "Problème technique"] as const).map((alert) => <button key={alert} className={currentRoom.alert === alert ? "selected" : ""} onClick={() => toggleRoomAlert(currentRoom, alert)}>{alert === "Problème technique" ? <Wrench size={16} /> : <TriangleAlert size={16} />}{alert}</button>)}</div>
              {(currentRoom.alert === "Problème technique" || currentRoomIncident) && (
                <>
                  <div className="technical-flow" role="group" aria-label="Suivi du problème technique">
                    {technicalSteps.map((step, index) => {
                      const currentIndex = Math.max(0, technicalSteps.findIndex((candidate) => candidate.value === currentRoomTechnicalStatus));
                      const complete = index <= currentIndex;
                      const current = step.value === currentRoomTechnicalStatus;
                      return <button key={step.value} disabled={technicalBusy} className={`${complete ? "complete" : ""} ${current ? "current" : ""}`} aria-pressed={current} onClick={() => void updateTechnicalStatus(currentRoom, step.value)}>{complete ? <Check size={14} /> : <span className="technical-step-dot" />}{step.label}</button>;
                    })}
                  </div>
                  <label className="technical-photo-upload">
                    <input type="file" accept="image/*" capture="environment" onChange={(event) => uploadTechnicalPhoto(currentRoom, event)} />
                    {currentRoomPhoto
                      ? <><img src={currentRoomPhoto} alt="Photo du problème technique" /><span><ImagePlus size={16} /> Remplacer la photo</span></>
                      : <span><ImagePlus size={18} /> Ajouter une photo <small>Facultatif · 5 Mo maximum</small></span>}
                  </label>
                  {currentRoomIncident && (
                    <div className="technical-shared-card">
                      <div><Wrench size={16} /><strong>Suivi commun Raccotel</strong><span>{technicalWorkflowLabels[currentRoomIncident.workflowStatus]}</span></div>
                      <p>{currentRoomIncident.description || "Aucune précision au signalement."}</p>
                      {currentRoomIncident.comment && <blockquote>{currentRoomIncident.comment}</blockquote>}
                      {currentRoomIncident.assignee && <small>Attribué à {currentRoomIncident.assignee}</small>}
                      <ol className="technical-history">
                        {activityForIncident(currentRoomIncident.id).slice(0, 8).map((entry) => (
                          <li key={entry.id}><span>{entry.action}</span><p>{entry.detail}</p><small>{entry.actor} · {new Date(entry.createdAt).toLocaleString("fr-FR")}</small></li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {technicalSyncError && <p className="technical-sync-error"><CircleAlert size={15} /> {technicalSyncError}</p>}
                </>
              )}
            </section>
            <section className="drawer-section comments-section"><label><span>Commentaire gouvernante (interne)</span><textarea value={currentRoom.floorComment ?? ""} onChange={(event) => updateRoom(currentRoom.number, { floorComment: event.target.value })} placeholder="Observation ou suivi interne…" /></label></section>
            <footer className="drawer-footer"><button className="button secondary" disabled={technicalBusy} onClick={() => setSelectedRoom(null)}>Fermer</button><button className="button primary" disabled={technicalBusy} onClick={() => void saveRoomTechnicalDetails(currentRoom)}><Check size={18} /> {technicalBusy ? "Synchronisation…" : "Enregistrer"}</button></footer>
          </aside>
        </div>
      )}

      {commonAreaDraft && (
        <div className="drawer-backdrop" onClick={closeCommonArea}>
          <aside className="room-drawer common-area-drawer" onClick={(event) => event.stopPropagation()} aria-label={`Détail de ${commonAreaDraft.name}`}>
            <div className="drawer-header">
              <div><p>Partie commune</p><h2>{commonAreaDraft.name}</h2><span>{shortDateLabel(workDate)}</span></div>
              <button className="icon-button ghost" onClick={closeCommonArea} aria-label="Fermer"><X size={21} /></button>
            </div>

            <section className="drawer-section">
              <div className="drawer-section-title"><h3>Action</h3><span>Sélectionne ce qui est nécessaire</span></div>
              <div className="common-action-options">
                <button type="button" className={commonAreaDraft.action === "Ménage" ? "selected cleaning" : ""} aria-pressed={commonAreaDraft.action === "Ménage"} onClick={() => selectCommonAreaAction("Ménage")}><Sparkles size={17} /> Ménage</button>
                <button type="button" className={commonAreaDraft.action === "Problème technique" ? "selected technical" : ""} aria-pressed={commonAreaDraft.action === "Problème technique"} onClick={() => selectCommonAreaAction("Problème technique")}><Wrench size={17} /> Problème technique</button>
                <button type="button" className={commonAreaDraft.completed ? "selected controlled" : ""} aria-pressed={commonAreaDraft.completed} onClick={() => setCommonAreaDraft({ ...commonAreaDraft, completed: !commonAreaDraft.completed })}><CheckCircle2 size={17} /> Contrôlé</button>
              </div>
            </section>

            {commonAreaDraft.action === "Ménage" && (
              <section className="drawer-section common-area-form">
                <div className="drawer-section-title"><h3>Demande de ménage</h3><span>Tous les champs sont obligatoires</span></div>
                <div className="common-area-form-grid">
                  <label className={commonAreaErrors.assignee ? "field-error" : ""}>
                    <span>Attribuer à *</span>
                    <select value={commonAreaDraft.assignee ?? ""} onChange={(event) => { setCommonAreaDraft({ ...commonAreaDraft, assignee: event.target.value }); setCommonAreaErrors({ ...commonAreaErrors, assignee: false }); }} aria-invalid={commonAreaErrors.assignee}>
                      <option value="">Choisir une personne</option>
                      {presentEmployees.map((employee) => <option key={employee.id} value={employee.name}>{employeeFullName(employee)}</option>)}
                    </select>
                    {commonAreaErrors.assignee && <small>Choisis la personne qui réalisera le ménage.</small>}
                  </label>
                  <label className={commonAreaErrors.minutes ? "field-error" : ""}>
                    <span>Temps de réalisation *</span>
                    <span className="duration-input"><input type="number" min="1" step="5" value={commonAreaDraft.minutes || ""} onChange={(event) => { setCommonAreaDraft({ ...commonAreaDraft, minutes: Number(event.target.value) }); setCommonAreaErrors({ ...commonAreaErrors, minutes: false }); }} aria-invalid={commonAreaErrors.minutes} /><em>min</em></span>
                    {commonAreaErrors.minutes && <small>Indique un temps supérieur à 0 minute.</small>}
                  </label>
                </div>
                <label className={commonAreaErrors.comment ? "field-error full-comment" : "full-comment"}>
                  <span>Commentaire *</span>
                  <textarea value={commonAreaDraft.comment ?? ""} onChange={(event) => { setCommonAreaDraft({ ...commonAreaDraft, comment: event.target.value }); setCommonAreaErrors({ ...commonAreaErrors, comment: false }); }} placeholder="Ex. nettoyer le sol et les vitres…" aria-invalid={commonAreaErrors.comment} />
                  {commonAreaErrors.comment && <small>Le commentaire est obligatoire pour demander du ménage.</small>}
                </label>
              </section>
            )}

            {commonAreaDraft.action === "Problème technique" && (
              <section className="drawer-section common-area-form">
                <div className="drawer-section-title"><h3>Problème technique</h3><span>Commentaire obligatoire</span></div>
                <div className="technical-flow" role="group" aria-label="Suivi du problème technique">
                  {technicalSteps.map((step, index) => {
                    const status = currentCommonAreaTechnicalStatus;
                    const currentIndex = Math.max(0, technicalSteps.findIndex((candidate) => candidate.value === status));
                    const complete = index <= currentIndex;
                    const current = step.value === status;
                    return <button key={step.value} disabled={technicalBusy} className={`${complete ? "complete" : ""} ${current ? "current" : ""}`} aria-pressed={current} onClick={() => void updateCommonAreaTechnicalStatus(step.value)}>{complete ? <Check size={14} /> : <span className="technical-step-dot" />}{step.label}</button>;
                  })}
                </div>
                <label className={commonAreaErrors.comment ? "field-error full-comment" : "full-comment"}>
                  <span>Commentaire *</span>
                  <textarea value={commonAreaDraft.comment ?? ""} onChange={(event) => { setCommonAreaDraft({ ...commonAreaDraft, comment: event.target.value }); setCommonAreaErrors({ ...commonAreaErrors, comment: false }); }} placeholder="Décris précisément le problème constaté…" aria-invalid={commonAreaErrors.comment} />
                  {commonAreaErrors.comment && <small>Le commentaire est obligatoire pour signaler le problème.</small>}
                </label>
                <label className="technical-photo-upload">
                  <input type="file" accept="image/*" capture="environment" onChange={uploadCommonAreaTechnicalPhoto} />
                  {currentCommonAreaPhoto
                    ? <><img src={currentCommonAreaPhoto} alt={`Photo du problème technique dans ${commonAreaDraft.name}`} /><span><ImagePlus size={16} /> Remplacer la photo</span></>
                    : <span><ImagePlus size={18} /> Ajouter une photo <small>Facultatif · 5 Mo maximum</small></span>}
                </label>
                {currentCommonAreaIncident && (
                  <div className="technical-shared-card">
                    <div><Wrench size={16} /><strong>Suivi commun Raccotel</strong><span>{technicalWorkflowLabels[currentCommonAreaIncident.workflowStatus]}</span></div>
                    {currentCommonAreaIncident.comment && <blockquote>{currentCommonAreaIncident.comment}</blockquote>}
                    {currentCommonAreaIncident.assignee && <small>Attribué à {currentCommonAreaIncident.assignee}</small>}
                    <ol className="technical-history">
                      {activityForIncident(currentCommonAreaIncident.id).slice(0, 8).map((entry) => (
                        <li key={entry.id}><span>{entry.action}</span><p>{entry.detail}</p><small>{entry.actor} · {new Date(entry.createdAt).toLocaleString("fr-FR")}</small></li>
                      ))}
                    </ol>
                  </div>
                )}
                {technicalSyncError && <p className="technical-sync-error"><CircleAlert size={15} /> {technicalSyncError}</p>}
              </section>
            )}

            <footer className="drawer-footer"><button className="button secondary" disabled={technicalBusy} onClick={closeCommonArea}>Annuler</button><button className="button primary" disabled={technicalBusy} onClick={() => void saveCommonArea()}><Check size={18} /> {technicalBusy ? "Synchronisation…" : "Enregistrer"}</button></footer>
          </aside>
        </div>
      )}

      {showPublish && (
        <div className="modal-backdrop" onClick={() => setShowPublish(false)}>
          <div className="modal publish-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">Distribution du jour</p><h2>Publier les feuilles individuelles</h2><p>Choisis le support de chaque femme de chambre.</p></div><button className="icon-button ghost" onClick={() => setShowPublish(false)}><X size={20} /></button></div>
            <div className="delivery-list">{presentEmployees.map((employee) => <div className="delivery-row" key={employee.id}><span className="person-cell"><span className="avatar">{employee.name[0]}</span><span><strong>{employeeFullName(employee)}</strong><small>{rooms.filter((room) => room.housekeeper === employee.name).length} chambres</small></span></span><div className="delivery-toggle"><button className={employee.delivery === "phone" ? "active" : ""} onClick={() => setDelivery(employee.id, "phone")}><Smartphone size={16} /> Téléphone</button><button className={employee.delivery === "pdf" ? "active" : ""} onClick={() => setDelivery(employee.id, "pdf")}><Printer size={16} /> PDF</button></div>{employee.delivery === "pdf" ? <button className="icon-button ghost" onClick={() => generateIndividualPdf(employee)} aria-label={`Télécharger la feuille de ${employeeFullName(employee)}`}><Download size={18} /></button> : <span className="ready-dot"><CheckCircle2 size={18} /> Prête</span>}</div>)}</div>
            <div className="modal-note"><CircleAlert size={17} /><p>Les feuilles téléphone sont consultables sans action possible. Les PDF sont générés individuellement pour impression.</p></div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setShowPublish(false)}>Annuler</button><button className="button primary" onClick={() => { const pdfEmployees = presentEmployees.filter((employee) => employee.delivery === "pdf"); pdfEmployees.forEach((employee) => generateIndividualPdf(employee)); setShowPublish(false); showToast(`Distribution publiée${pdfEmployees.length ? ` · ${pdfEmployees.length} PDF généré${pdfEmployees.length > 1 ? "s" : ""}` : ""}`); }}><Send size={18} /> Publier maintenant</button></div>
          </div>
        </div>
      )}

      {showAddEmployee && (
        <div className="modal-backdrop" onClick={() => setShowAddEmployee(false)}>
          <div className="modal small-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">Référentiel</p><h2>Ajouter une femme de chambre</h2></div><button className="icon-button ghost" onClick={() => setShowAddEmployee(false)}><X size={20} /></button></div>
            <div className="form-grid"><label>Prénom<input autoFocus value={newEmployee.name} onChange={(event) => setNewEmployee({ ...newEmployee, name: event.target.value })} placeholder="Ex. Maria" /></label><label>Nom de famille<input value={newEmployee.lastName} onChange={(event) => setNewEmployee({ ...newEmployee, lastName: event.target.value })} placeholder="Ex. Dupont" /></label><label>Contrat<select value={newEmployee.contract} onChange={(event) => setNewEmployee({ ...newEmployee, contract: event.target.value })}><option>24 h</option><option>30 h</option><option>35 h</option><option>39 h</option><option>Extra</option></select></label><label>Pause<select value={newEmployee.pause} onChange={(event) => setNewEmployee({ ...newEmployee, pause: Number(event.target.value) })}>{[20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}</select></label><label>Début<input type="time" value={newEmployee.start} onChange={(event) => setNewEmployee({ ...newEmployee, start: event.target.value })} /></label><label>Fin<input type="time" value={newEmployee.end} onChange={(event) => setNewEmployee({ ...newEmployee, end: event.target.value })} /></label><label className="full-field">Support habituel<select value={newEmployee.delivery} onChange={(event) => setNewEmployee({ ...newEmployee, delivery: event.target.value as DeliveryMethod })}><option value="phone">Téléphone</option><option value="pdf">PDF imprimé</option></select></label></div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setShowAddEmployee(false)}>Annuler</button><button className="button primary" onClick={addEmployee}><Plus size={18} /> Ajouter</button></div>
          </div>
        </div>
      )}

      {editingEmployee && (
        <div className="modal-backdrop" onClick={() => setEditingEmployee(null)}>
          <div className="modal small-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">Référentiel</p><h2>Modifier la fiche</h2><p>Identité, contrat et horaires habituels.</p></div><button className="icon-button ghost" onClick={() => setEditingEmployee(null)}><X size={20} /></button></div>
            <div className="form-grid">
              <label>Prénom<input autoFocus value={editingEmployee.name} onChange={(event) => setEditingEmployee({ ...editingEmployee, name: event.target.value })} /></label>
              <label>Nom de famille<input value={editingEmployee.lastName} onChange={(event) => setEditingEmployee({ ...editingEmployee, lastName: event.target.value })} placeholder="À renseigner" /></label>
              <label>Contrat<select value={editingEmployee.contract} onChange={(event) => setEditingEmployee({ ...editingEmployee, contract: event.target.value })}><option>24 h</option><option>30 h</option><option>35 h</option><option>39 h</option><option>Extra</option></select></label>
              <label>Pause habituelle<select value={editingEmployee.pause} onChange={(event) => setEditingEmployee({ ...editingEmployee, pause: Number(event.target.value) })}>{[20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}</select></label>
              <label>Début habituel<input type="time" value={editingEmployee.start} onChange={(event) => setEditingEmployee({ ...editingEmployee, start: event.target.value })} /></label>
              <label>Fin habituelle<input type="time" value={editingEmployee.end} onChange={(event) => setEditingEmployee({ ...editingEmployee, end: event.target.value })} /></label>
              <label className="full-field">Support habituel<select value={editingEmployee.delivery} onChange={(event) => setEditingEmployee({ ...editingEmployee, delivery: event.target.value as DeliveryMethod })}><option value="phone">Téléphone</option><option value="pdf">PDF imprimé</option></select></label>
            </div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setEditingEmployee(null)}>Annuler</button><button className="button primary" onClick={saveEmployeeEdit}><Check size={18} /> Enregistrer les modifications</button></div>
          </div>
        </div>
      )}

      {showRoomSettings && (
        <div className="modal-backdrop" onClick={() => setShowRoomSettings(false)}>
          <div className="modal room-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">Configuration multi-hôtel</p><h2>Chambres et typologies</h2><p>Modifie les numéros, les catégories et les dispositions habituelles de l’établissement.</p></div><button className="icon-button ghost" onClick={() => setShowRoomSettings(false)} aria-label="Fermer"><X size={20} /></button></div>
            <div className="room-settings-summary"><span><strong>{roomSettingsDraft.length}</strong> chambres</span><span><strong>{new Set(roomSettingsDraft.map((room) => room.category).filter(Boolean)).size}</strong> typologies</span><button className="button secondary compact" onClick={addRoomSettingsDraft}><Plus size={16} /> Ajouter une chambre</button></div>
            <div className="room-settings-table-wrap">
              <table className="room-settings-table">
                <thead><tr><th>Chambre</th><th>Typologie / catégorie</th><th>Disposition habituelle</th><th aria-label="Supprimer" /></tr></thead>
                <tbody>
                  {roomSettingsDraft.map((room) => (
                    <tr key={room.id}>
                      <td><input value={room.number} onChange={(event) => updateRoomSettingsDraft(room.id, { number: event.target.value })} placeholder="Ex. 101" /></td>
                      <td><input list="room-category-options" value={room.category} onChange={(event) => updateRoomSettingsDraft(room.id, { category: event.target.value })} placeholder="Ex. CLASSIQUE" /></td>
                      <td><select value={room.defaultLayout} onChange={(event) => updateRoomSettingsDraft(room.id, { defaultLayout: event.target.value })}>{["DBL", "TWIN", "TPL DBL", "TPL TWIN"].map((layout) => <option key={layout}>{layout}</option>)}</select></td>
                      <td><button className="icon-button ghost danger" onClick={() => setRoomSettingsDraft((current) => current.filter((candidate) => candidate.id !== room.id))} aria-label={`Supprimer la chambre ${room.number || "sans numéro"}`}><Trash2 size={17} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="room-category-options">{Array.from(new Set(roomSettingsDraft.map((room) => room.category).filter(Boolean))).map((category) => <option key={category} value={category} />)}</datalist>
            </div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setShowRoomSettings(false)}>Annuler</button><button className="button primary" onClick={saveRoomSettings}><Check size={18} /> Enregistrer le référentiel</button></div>
          </div>
        </div>
      )}

      {toast && <div className="toast"><CheckCircle2 size={19} /><span>{toast}</span></div>}
    </div>
  );
}
