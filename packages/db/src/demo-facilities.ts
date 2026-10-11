import type {
  buildings,
  decisionMakers,
  facilities,
  facilityHazards,
} from "./schema";

type DemoFacility = typeof facilities.$inferInsert & { readonly id: number };

// `.example` is a reserved TLD, so no seeded address reaches a real person.
const DEMO_EMAIL_DOMAIN = "usda.example";

const DANA_WHITFIELD_ID = 1;
const MARCUS_OYELARAN_ID = 2;
const PRIYA_RAMAN_ID = 3;
const TOMAS_IBARRA_ID = 4;
const GRACE_LINDQVIST_ID = 5;

const KANSAS_CITY_MAIN_OFFICE_ID = 1;
const KANSAS_CITY_ANNEX_ID = 2;
const KANSAS_CITY_EQUIPMENT_BARN_ID = 3;
const FARGO_MAIN_OFFICE_ID = 4;
const YAKIMA_MAIN_OFFICE_ID = 5;
const LAFAYETTE_MAIN_OFFICE_ID = 6;

function demoEmail(name: string): string {
  return `${name.toLowerCase().replaceAll(" ", ".")}@${DEMO_EMAIL_DOMAIN}`;
}

const DEMO_DECISION_MAKERS: (typeof decisionMakers.$inferInsert)[] = [
  {
    id: DANA_WHITFIELD_ID,
    name: "Dana Whitfield",
    role: "County Executive Director",
    email: demoEmail("Dana Whitfield"),
  },
  {
    id: MARCUS_OYELARAN_ID,
    name: "Marcus Oyelaran",
    role: "State Administrative Officer",
    email: demoEmail("Marcus Oyelaran"),
  },
  {
    id: PRIYA_RAMAN_ID,
    name: "Priya Raman",
    role: "District Conservationist",
    email: demoEmail("Priya Raman"),
  },
  {
    id: TOMAS_IBARRA_ID,
    name: "Tomas Ibarra",
    role: "Facility Operations Manager",
    email: demoEmail("Tomas Ibarra"),
  },
  {
    id: GRACE_LINDQVIST_ID,
    name: "Grace Lindqvist",
    role: "Deputy State Executive Director",
    email: demoEmail("Grace Lindqvist"),
  },
];

// Zones and time zones come from api.weather.gov/points/<latitude>,<longitude>; look them up again after moving a facility.
const KANSAS_CITY: DemoFacility = {
  id: 1,
  name: "Kansas City Area Service Center",
  latitude: 39.0997,
  longitude: -94.5786,
  nwsZone: "MOZ037",
  timezone: "America/Chicago",
  opensAt: "07:30",
  closesAt: "16:30",
  arrivalWindowStart: "06:30",
  arrivalWindowEnd: "09:00",
  departureWindowStart: "15:30",
  departureWindowEnd: "18:00",
  typicalCommuteMinutes: 35,
  decisionDeadline: "05:00",
  notificationLeadMinutes: 60,
  // I-70 and I-35 through the metro core carry AADT over 30,000.
  roadClass: "superCommuter",
  decisionMakerId: DANA_WHITFIELD_ID,
  backupDecisionMakerId: MARCUS_OYELARAN_ID,
};

const FARGO: DemoFacility = {
  id: 2,
  name: "Fargo Service Center",
  latitude: 46.8772,
  longitude: -96.7898,
  nwsZone: "NDZ039",
  timezone: "America/Chicago",
  opensAt: "08:00",
  closesAt: "16:30",
  arrivalWindowStart: "07:00",
  arrivalWindowEnd: "09:00",
  departureWindowStart: "16:00",
  departureWindowEnd: "17:30",
  typicalCommuteMinutes: 20,
  decisionDeadline: "05:30",
  notificationLeadMinutes: 45,
  roadClass: "urbanCommuter",
  decisionMakerId: GRACE_LINDQVIST_ID,
  backupDecisionMakerId: MARCUS_OYELARAN_ID,
};

const YAKIMA: DemoFacility = {
  id: 3,
  name: "Yakima Service Center",
  latitude: 46.6021,
  longitude: -120.5059,
  nwsZone: "WAZ027",
  timezone: "America/Los_Angeles",
  opensAt: "07:30",
  closesAt: "16:00",
  arrivalWindowStart: "06:45",
  arrivalWindowEnd: "08:30",
  departureWindowStart: "15:30",
  departureWindowEnd: "17:00",
  typicalCommuteMinutes: 25,
  decisionDeadline: "05:15",
  notificationLeadMinutes: 45,
  // Staff commute in on valley orchard routes.
  roadClass: "ruralCommuter",
  decisionMakerId: PRIYA_RAMAN_ID,
  backupDecisionMakerId: TOMAS_IBARRA_ID,
};

const LAFAYETTE: DemoFacility = {
  id: 4,
  name: "Lafayette Service Center",
  latitude: 30.2241,
  longitude: -92.0198,
  nwsZone: "LAZ044",
  timezone: "America/Chicago",
  opensAt: "07:00",
  closesAt: "15:30",
  arrivalWindowStart: "06:30",
  arrivalWindowEnd: "08:00",
  departureWindowStart: "15:00",
  departureWindowEnd: "16:30",
  typicalCommuteMinutes: 30,
  decisionDeadline: "05:00",
  notificationLeadMinutes: 60,
  roadClass: "urbanCommuter",
  decisionMakerId: TOMAS_IBARRA_ID,
  backupDecisionMakerId: PRIYA_RAMAN_ID,
};

const DEMO_FACILITIES: DemoFacility[] = [KANSAS_CITY, FARGO, YAKIMA, LAFAYETTE];

const DEMO_FACILITY_HAZARDS: (typeof facilityHazards.$inferInsert)[] = [
  { facilityId: KANSAS_CITY.id, hazard: "winter" },
  { facilityId: KANSAS_CITY.id, hazard: "wind" },
  { facilityId: KANSAS_CITY.id, hazard: "airQuality" },
  { facilityId: FARGO.id, hazard: "winter" },
  { facilityId: FARGO.id, hazard: "wind" },
  { facilityId: YAKIMA.id, hazard: "airQuality" },
  { facilityId: YAKIMA.id, hazard: "winter" },
  { facilityId: LAFAYETTE.id, hazard: "wind" },
];

const DEMO_BUILDINGS: (typeof buildings.$inferInsert)[] = [
  {
    id: KANSAS_CITY_MAIN_OFFICE_ID,
    facilityId: KANSAS_CITY.id,
    name: "Main Office",
  },
  { id: KANSAS_CITY_ANNEX_ID, facilityId: KANSAS_CITY.id, name: "Annex" },
  {
    id: KANSAS_CITY_EQUIPMENT_BARN_ID,
    facilityId: KANSAS_CITY.id,
    name: "Equipment Barn",
  },
  { id: FARGO_MAIN_OFFICE_ID, facilityId: FARGO.id, name: "Main Office" },
  { id: YAKIMA_MAIN_OFFICE_ID, facilityId: YAKIMA.id, name: "Main Office" },
  {
    id: LAFAYETTE_MAIN_OFFICE_ID,
    facilityId: LAFAYETTE.id,
    name: "Main Office",
  },
];

export type { DemoFacility };
export {
  DEMO_BUILDINGS,
  DEMO_DECISION_MAKERS,
  DEMO_FACILITIES,
  DEMO_FACILITY_HAZARDS,
  demoEmail,
  FARGO,
  FARGO_MAIN_OFFICE_ID,
  KANSAS_CITY,
  KANSAS_CITY_ANNEX_ID,
  KANSAS_CITY_EQUIPMENT_BARN_ID,
  KANSAS_CITY_MAIN_OFFICE_ID,
  LAFAYETTE,
  LAFAYETTE_MAIN_OFFICE_ID,
  YAKIMA,
  YAKIMA_MAIN_OFFICE_ID,
};
