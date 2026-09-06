import * as z from "zod";
const zAccessListId = z.int();
const zAllianceId = z.int();
const zAlliancesAllianceIdContactsGet = z.array(z.looseObject({
  contact_id: z.int(),
  contact_type: z.enum([
    "character",
    "corporation",
    "alliance",
    "faction"
  ]),
  label_ids: z.array(z.int()).optional(),
  standing: z.number()
}));
const zAlliancesAllianceIdContactsLabelsGet = z.array(z.looseObject({
  label_id: z.int(),
  label_name: z.string()
}));
const zAlliancesAllianceIdCorporationsGet = z.array(z.int()).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zAlliancesAllianceIdIconsGet = z.looseObject({
  px128x128: z.string().optional(),
  px64x64: z.string().optional()
});
const zAlliancesGet = z.array(z.int()).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zArchetypeId = z.int();
const zAttributeId = z.int();
const zBloodlineId = z.int();
const zCharacterId = z.int();
const zCharactersAccessListsDetailAllianceentry = z.looseObject({
  access: z.enum([
    "Unspecified",
    "Allowed",
    "Blocked",
    "Manager",
    "Admin"
  ]),
  alliance_id: zAllianceId
});
const zCharactersAccessListsDetailCharacterentry = z.looseObject({
  access: z.enum([
    "Unspecified",
    "Allowed",
    "Blocked",
    "Manager",
    "Admin"
  ]),
  character_id: zCharacterId
});
const zCharactersAccessListsListingAccesslist = z.looseObject({
  id: zAccessListId
});
const zCharactersAccessListsListing = z.looseObject({
  access_lists: z.array(zCharactersAccessListsListingAccesslist)
});
const zCharactersAffiliationPost = z.array(z.looseObject({
  alliance_id: z.int().optional(),
  character_id: z.int(),
  corporation_id: z.int(),
  faction_id: z.int().optional()
}));
const zCharactersCharacterIdAgentsResearchGet = z.array(z.looseObject({
  agent_id: z.int(),
  points_per_day: z.number(),
  remainder_points: z.number(),
  skill_type_id: z.int(),
  started_at: z.iso.datetime({ offset: true })
}));
const zCharactersCharacterIdAssetsGet = z.array(z.looseObject({
  is_blueprint_copy: z.boolean().optional(),
  is_singleton: z.boolean(),
  item_id: z.int(),
  location_flag: z.enum([
    "AssetSafety",
    "AutoFit",
    "BoosterBay",
    "CapsuleerDeliveries",
    "Cargo",
    "CorporationGoalDeliveries",
    "CorpseBay",
    "Deliveries",
    "DroneBay",
    "ExpeditionHold",
    "FighterBay",
    "FighterTube0",
    "FighterTube1",
    "FighterTube2",
    "FighterTube3",
    "FighterTube4",
    "FleetHangar",
    "FrigateEscapeBay",
    "Hangar",
    "HangarAll",
    "HiSlot0",
    "HiSlot1",
    "HiSlot2",
    "HiSlot3",
    "HiSlot4",
    "HiSlot5",
    "HiSlot6",
    "HiSlot7",
    "HiddenModifiers",
    "Implant",
    "InfrastructureHangar",
    "LoSlot0",
    "LoSlot1",
    "LoSlot2",
    "LoSlot3",
    "LoSlot4",
    "LoSlot5",
    "LoSlot6",
    "LoSlot7",
    "Locked",
    "MedSlot0",
    "MedSlot1",
    "MedSlot2",
    "MedSlot3",
    "MedSlot4",
    "MedSlot5",
    "MedSlot6",
    "MedSlot7",
    "MobileDepotHold",
    "MoonMaterialBay",
    "QuafeBay",
    "RigSlot0",
    "RigSlot1",
    "RigSlot2",
    "RigSlot3",
    "RigSlot4",
    "RigSlot5",
    "RigSlot6",
    "RigSlot7",
    "ShipHangar",
    "Skill",
    "SpecializedAmmoHold",
    "SpecializedAsteroidHold",
    "SpecializedCommandCenterHold",
    "SpecializedFuelBay",
    "SpecializedGasHold",
    "SpecializedIceHold",
    "SpecializedIndustrialShipHold",
    "SpecializedLargeShipHold",
    "SpecializedMaterialBay",
    "SpecializedMediumShipHold",
    "SpecializedMineralHold",
    "SpecializedOreHold",
    "SpecializedPlanetaryCommoditiesHold",
    "SpecializedSalvageHold",
    "SpecializedShipHold",
    "SpecializedSmallShipHold",
    "StructureDeedBay",
    "SubSystemBay",
    "SubSystemSlot0",
    "SubSystemSlot1",
    "SubSystemSlot2",
    "SubSystemSlot3",
    "SubSystemSlot4",
    "SubSystemSlot5",
    "SubSystemSlot6",
    "SubSystemSlot7",
    "Unlocked",
    "Wardrobe"
  ]),
  location_id: z.int(),
  location_type: z.enum([
    "station",
    "solar_system",
    "item",
    "other"
  ]),
  quantity: z.int(),
  type_id: z.int()
}));
const zCharactersCharacterIdAssetsLocationsPost = z.array(z.looseObject({
  item_id: z.int(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  })
}));
const zCharactersCharacterIdAssetsNamesPost = z.array(z.looseObject({
  item_id: z.int(),
  name: z.string()
}));
const zCharactersCharacterIdAttributesGet = z.looseObject({
  accrued_remap_cooldown_date: z.iso.datetime({ offset: true }).optional(),
  bonus_remaps: z.int().optional(),
  charisma: z.int(),
  intelligence: z.int(),
  last_remap_date: z.iso.datetime({ offset: true }).optional(),
  memory: z.int(),
  perception: z.int(),
  willpower: z.int()
});
const zCharactersCharacterIdBlueprintsGet = z.array(z.looseObject({
  item_id: z.int(),
  location_flag: z.enum([
    "AutoFit",
    "Cargo",
    "CorpseBay",
    "DroneBay",
    "FleetHangar",
    "Deliveries",
    "HiddenModifiers",
    "Hangar",
    "HangarAll",
    "LoSlot0",
    "LoSlot1",
    "LoSlot2",
    "LoSlot3",
    "LoSlot4",
    "LoSlot5",
    "LoSlot6",
    "LoSlot7",
    "MedSlot0",
    "MedSlot1",
    "MedSlot2",
    "MedSlot3",
    "MedSlot4",
    "MedSlot5",
    "MedSlot6",
    "MedSlot7",
    "HiSlot0",
    "HiSlot1",
    "HiSlot2",
    "HiSlot3",
    "HiSlot4",
    "HiSlot5",
    "HiSlot6",
    "HiSlot7",
    "AssetSafety",
    "Locked",
    "Unlocked",
    "Implant",
    "QuafeBay",
    "RigSlot0",
    "RigSlot1",
    "RigSlot2",
    "RigSlot3",
    "RigSlot4",
    "RigSlot5",
    "RigSlot6",
    "RigSlot7",
    "ShipHangar",
    "SpecializedFuelBay",
    "SpecializedOreHold",
    "SpecializedGasHold",
    "SpecializedMineralHold",
    "SpecializedSalvageHold",
    "SpecializedShipHold",
    "SpecializedSmallShipHold",
    "SpecializedMediumShipHold",
    "SpecializedLargeShipHold",
    "SpecializedIndustrialShipHold",
    "SpecializedAmmoHold",
    "SpecializedCommandCenterHold",
    "SpecializedPlanetaryCommoditiesHold",
    "SpecializedMaterialBay",
    "SubSystemSlot0",
    "SubSystemSlot1",
    "SubSystemSlot2",
    "SubSystemSlot3",
    "SubSystemSlot4",
    "SubSystemSlot5",
    "SubSystemSlot6",
    "SubSystemSlot7",
    "FighterBay",
    "FighterTube0",
    "FighterTube1",
    "FighterTube2",
    "FighterTube3",
    "FighterTube4",
    "Module"
  ]),
  location_id: z.int(),
  material_efficiency: z.int(),
  quantity: z.int(),
  runs: z.int(),
  time_efficiency: z.int(),
  type_id: z.int()
}));
const zCharactersCharacterIdCalendarEventIdAttendeesGet = z.array(z.looseObject({
  character_id: z.int().optional(),
  event_response: z.enum([
    "declined",
    "not_responded",
    "accepted",
    "tentative"
  ]).optional()
}));
const zCharactersCharacterIdCalendarEventIdGet = z.looseObject({
  date: z.iso.datetime({ offset: true }),
  duration: z.int(),
  event_id: z.int(),
  importance: z.int(),
  owner_id: z.int(),
  owner_name: z.string(),
  owner_type: z.enum([
    "eve_server",
    "corporation",
    "faction",
    "character",
    "alliance"
  ]),
  response: z.string(),
  text: z.string(),
  title: z.string()
});
const zCharactersCharacterIdCalendarGet = z.array(z.looseObject({
  event_date: z.iso.datetime({ offset: true }).optional(),
  event_id: z.int().optional(),
  event_response: z.enum([
    "declined",
    "not_responded",
    "accepted",
    "tentative"
  ]).optional(),
  importance: z.int().optional(),
  title: z.string().optional()
}));
const zCharactersCharacterIdClonesGet = z.looseObject({
  home_location: z.looseObject({
    location_id: z.int().optional(),
    location_type: z.enum(["station", "structure"]).optional()
  }).optional(),
  jump_clones: z.array(z.looseObject({
    implants: z.array(z.int()),
    jump_clone_id: z.int(),
    location_id: z.int(),
    location_type: z.enum(["station", "structure"]),
    name: z.string().optional()
  })),
  last_clone_jump_date: z.iso.datetime({ offset: true }).optional(),
  last_station_change_date: z.iso.datetime({ offset: true }).optional()
});
const zCharactersCharacterIdContactsGet = z.array(z.looseObject({
  contact_id: z.int(),
  contact_type: z.enum([
    "character",
    "corporation",
    "alliance",
    "faction"
  ]),
  is_blocked: z.boolean().optional(),
  is_watched: z.boolean().optional(),
  label_ids: z.array(z.int()).optional(),
  standing: z.number()
}));
const zCharactersCharacterIdContactsLabelsGet = z.array(z.looseObject({
  label_id: z.int(),
  label_name: z.string()
}));
const zCharactersCharacterIdContactsPost = z.array(z.int());
const zCharactersCharacterIdContractsContractIdBidsGet = z.array(z.looseObject({
  amount: z.number(),
  bid_id: z.int(),
  bidder_id: z.int(),
  date_bid: z.iso.datetime({ offset: true })
}));
const zCharactersCharacterIdContractsContractIdItemsGet = z.array(z.looseObject({
  is_included: z.boolean(),
  is_singleton: z.boolean(),
  quantity: z.int(),
  raw_quantity: z.int().optional(),
  record_id: z.int(),
  type_id: z.int()
}));
const zCharactersCharacterIdContractsGet = z.array(z.looseObject({
  acceptor_id: z.int(),
  assignee_id: z.int(),
  availability: z.enum([
    "public",
    "personal",
    "corporation",
    "alliance"
  ]),
  buyout: z.number().optional(),
  collateral: z.number().optional(),
  contract_id: z.int(),
  date_accepted: z.iso.datetime({ offset: true }).optional(),
  date_completed: z.iso.datetime({ offset: true }).optional(),
  date_expired: z.iso.datetime({ offset: true }),
  date_issued: z.iso.datetime({ offset: true }),
  days_to_complete: z.int().optional(),
  end_location_id: z.int().optional(),
  for_corporation: z.boolean(),
  issuer_corporation_id: z.int(),
  issuer_id: z.int(),
  price: z.number().optional(),
  reward: z.number().optional(),
  start_location_id: z.int().optional(),
  status: z.enum([
    "outstanding",
    "in_progress",
    "finished_issuer",
    "finished_contractor",
    "finished",
    "cancelled",
    "rejected",
    "failed",
    "deleted",
    "reversed"
  ]),
  title: z.string().optional(),
  type: z.enum([
    "unknown",
    "item_exchange",
    "auction",
    "courier",
    "loan"
  ]),
  volume: z.number().optional()
}));
const zCharactersCharacterIdCorporationhistoryGet = z.array(z.looseObject({
  corporation_id: z.int(),
  is_deleted: z.boolean().optional(),
  record_id: z.int(),
  start_date: z.iso.datetime({ offset: true })
}));
const zCharactersCharacterIdCspaPost = z.number();
const zCharactersCharacterIdFatigueGet = z.looseObject({
  jump_fatigue_expire_date: z.iso.datetime({ offset: true }).optional(),
  last_jump_date: z.iso.datetime({ offset: true }).optional(),
  last_update_date: z.iso.datetime({ offset: true }).optional()
});
const zCharactersCharacterIdFittingsGet = z.array(z.looseObject({
  description: z.string(),
  fitting_id: z.int(),
  items: z.array(z.looseObject({
    flag: z.enum([
      "Cargo",
      "DroneBay",
      "FighterBay",
      "HiSlot0",
      "HiSlot1",
      "HiSlot2",
      "HiSlot3",
      "HiSlot4",
      "HiSlot5",
      "HiSlot6",
      "HiSlot7",
      "Invalid",
      "LoSlot0",
      "LoSlot1",
      "LoSlot2",
      "LoSlot3",
      "LoSlot4",
      "LoSlot5",
      "LoSlot6",
      "LoSlot7",
      "MedSlot0",
      "MedSlot1",
      "MedSlot2",
      "MedSlot3",
      "MedSlot4",
      "MedSlot5",
      "MedSlot6",
      "MedSlot7",
      "RigSlot0",
      "RigSlot1",
      "RigSlot2",
      "ServiceSlot0",
      "ServiceSlot1",
      "ServiceSlot2",
      "ServiceSlot3",
      "ServiceSlot4",
      "ServiceSlot5",
      "ServiceSlot6",
      "ServiceSlot7",
      "SubSystemSlot0",
      "SubSystemSlot1",
      "SubSystemSlot2",
      "SubSystemSlot3"
    ]),
    quantity: z.int(),
    type_id: z.int()
  })),
  name: z.string(),
  ship_type_id: z.int()
}));
const zCharactersCharacterIdFittingsPost = z.looseObject({
  fitting_id: z.int()
});
const zCharactersCharacterIdFleetGet = z.looseObject({
  fleet_boss_id: z.int(),
  fleet_id: z.int(),
  role: z.enum([
    "fleet_commander",
    "squad_commander",
    "squad_member",
    "wing_commander"
  ]),
  squad_id: z.int(),
  wing_id: z.int()
});
const zCharactersCharacterIdFwStatsGet = z.looseObject({
  current_rank: z.int().optional(),
  enlisted_on: z.iso.datetime({ offset: true }).optional(),
  faction_id: z.int().optional(),
  highest_rank: z.int().optional(),
  kills: z.looseObject({
    last_week: z.int(),
    total: z.int(),
    yesterday: z.int()
  }),
  victory_points: z.looseObject({
    last_week: z.int(),
    total: z.int(),
    yesterday: z.int()
  })
});
const zCharactersCharacterIdImplantsGet = z.array(z.int());
const zCharactersCharacterIdIndustryJobsGet = z.array(z.looseObject({
  activity_id: z.int(),
  blueprint_id: z.int(),
  blueprint_location_id: z.int(),
  blueprint_type_id: z.int(),
  completed_character_id: z.int().optional(),
  completed_date: z.iso.datetime({ offset: true }).optional(),
  cost: z.number().optional(),
  duration: z.int(),
  end_date: z.iso.datetime({ offset: true }),
  facility_id: z.int(),
  installer_id: z.int(),
  job_id: z.int(),
  licensed_runs: z.int().optional(),
  output_location_id: z.int(),
  pause_date: z.iso.datetime({ offset: true }).optional(),
  probability: z.number().optional(),
  product_type_id: z.int().optional(),
  runs: z.int(),
  start_date: z.iso.datetime({ offset: true }),
  station_id: z.int(),
  status: z.enum([
    "active",
    "cancelled",
    "delivered",
    "paused",
    "ready",
    "reverted"
  ]),
  successful_runs: z.int().optional()
}));
const zCharactersCharacterIdKillmailsRecentGet = z.array(z.looseObject({
  killmail_hash: z.string(),
  killmail_id: z.int()
}));
const zCharactersCharacterIdLocationGet = z.looseObject({
  solar_system_id: z.int(),
  station_id: z.int().optional(),
  structure_id: z.int().optional()
});
const zCharactersCharacterIdLoyaltyPointsGet = z.array(z.looseObject({
  corporation_id: z.int(),
  loyalty_points: z.int()
}));
const zCharactersCharacterIdMailGet = z.array(z.looseObject({
  from: z.int().optional(),
  is_read: z.boolean().optional(),
  labels: z.array(z.int()).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  mail_id: z.int().optional(),
  recipients: z.array(z.looseObject({
    recipient_id: z.int(),
    recipient_type: z.enum([
      "alliance",
      "character",
      "corporation",
      "mailing_list"
    ])
  })).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  subject: z.string().optional(),
  timestamp: z.iso.datetime({ offset: true }).optional()
}));
const zCharactersCharacterIdMailLabelsGet = z.looseObject({
  labels: z.array(z.looseObject({
    color: z.enum([
      "#0000fe",
      "#006634",
      "#0099ff",
      "#00ff33",
      "#01ffff",
      "#349800",
      "#660066",
      "#666666",
      "#999999",
      "#99ffff",
      "#9a0000",
      "#ccff9a",
      "#e6e6e6",
      "#fe0000",
      "#ff6600",
      "#ffff01",
      "#ffffcd",
      "#ffffff"
    ]).optional().default("#ffffff"),
    label_id: z.int().optional(),
    name: z.string().optional(),
    unread_count: z.int().optional()
  })).optional(),
  total_unread_count: z.int().optional()
});
const zCharactersCharacterIdMailLabelsPost = z.int();
const zCharactersCharacterIdMailListsGet = z.array(z.looseObject({
  mailing_list_id: z.int(),
  name: z.string()
}));
const zCharactersCharacterIdMailMailIdGet = z.looseObject({
  body: z.string().optional(),
  from: z.int().optional(),
  labels: z.array(z.int()).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  read: z.boolean().optional(),
  recipients: z.array(z.looseObject({
    recipient_id: z.int(),
    recipient_type: z.enum([
      "alliance",
      "character",
      "corporation",
      "mailing_list"
    ])
  })).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  subject: z.string().optional(),
  timestamp: z.iso.datetime({ offset: true }).optional()
});
const zCharactersCharacterIdMailPost = z.int();
const zCharactersCharacterIdMedalsGet = z.array(z.looseObject({
  corporation_id: z.int(),
  date: z.iso.datetime({ offset: true }),
  description: z.string(),
  graphics: z.array(z.looseObject({
    color: z.int().optional(),
    graphic: z.string(),
    layer: z.int(),
    part: z.int()
  })),
  issuer_id: z.int(),
  medal_id: z.int(),
  reason: z.string(),
  status: z.enum(["public", "private"]),
  title: z.string()
}));
const zCharactersCharacterIdMiningGet = z.array(z.looseObject({
  date: z.iso.date(),
  quantity: z.int(),
  solar_system_id: z.int(),
  type_id: z.int()
}));
const zCharactersCharacterIdNotificationsContactsGet = z.array(z.looseObject({
  message: z.string(),
  notification_id: z.int(),
  send_date: z.iso.datetime({ offset: true }),
  sender_character_id: z.int(),
  standing_level: z.number()
}));
const zCharactersCharacterIdNotificationsGet = z.array(z.looseObject({
  is_read: z.boolean().optional(),
  notification_id: z.int(),
  sender_id: z.int(),
  sender_type: z.enum([
    "character",
    "corporation",
    "alliance",
    "faction",
    "other"
  ]),
  text: z.string().optional(),
  timestamp: z.iso.datetime({ offset: true }),
  type: z.enum([
    "AcceptedAlly",
    "AcceptedSurrender",
    "AgentRetiredTrigravian",
    "AllAnchoringMsg",
    "AllMaintenanceBillMsg",
    "AllStrucInvulnerableMsg",
    "AllStructVulnerableMsg",
    "AllWarCorpJoinedAllianceMsg",
    "AllWarDeclaredMsg",
    "AllWarInvalidatedMsg",
    "AllWarRetractedMsg",
    "AllWarSurrenderMsg",
    "AllianceCapitalChanged",
    "AllianceWarDeclaredV2",
    "AllyContractCancelled",
    "AllyJoinedWarAggressorMsg",
    "AllyJoinedWarAllyMsg",
    "AllyJoinedWarDefenderMsg",
    "BattlePunishFriendlyFire",
    "BillOutOfMoneyMsg",
    "BillPaidCorpAllMsg",
    "BountyClaimMsg",
    "BountyESSShared",
    "BountyESSTaken",
    "BountyPlacedAlliance",
    "BountyPlacedChar",
    "BountyPlacedCorp",
    "BountyYourBountyClaimed",
    "BuddyConnectContactAdd",
    "CharAppAcceptMsg",
    "CharAppRejectMsg",
    "CharAppWithdrawMsg",
    "CharLeftCorpMsg",
    "CharMedalMsg",
    "CharTerminationMsg",
    "CloneActivationMsg",
    "CloneActivationMsg2",
    "CloneMovedMsg",
    "CloneRevokedMsg1",
    "CloneRevokedMsg2",
    "CombatOperationFinished",
    "ContactAdd",
    "ContactEdit",
    "ContainerPasswordMsg",
    "ContractRegionChangedToPochven",
    "CorpAllBillMsg",
    "CorpAppAcceptMsg",
    "CorpAppInvitedMsg",
    "CorpAppNewMsg",
    "CorpAppRejectCustomMsg",
    "CorpAppRejectMsg",
    "CorpBecameWarEligible",
    "CorpDividendMsg",
    "CorpFriendlyFireDisableTimerCompleted",
    "CorpFriendlyFireDisableTimerStarted",
    "CorpFriendlyFireEnableTimerCompleted",
    "CorpFriendlyFireEnableTimerStarted",
    "CorpKicked",
    "CorpLiquidationMsg",
    "CorpNewCEOMsg",
    "CorpNewsMsg",
    "CorpNoLongerWarEligible",
    "CorpOfficeExpirationMsg",
    "CorpStructLostMsg",
    "CorpTaxChangeMsg",
    "CorpVoteCEORevokedMsg",
    "CorpVoteMsg",
    "CorpWarDeclaredMsg",
    "CorpWarDeclaredV2",
    "CorpWarFightingLegalMsg",
    "CorpWarInvalidatedMsg",
    "CorpWarRetractedMsg",
    "CorpWarSurrenderMsg",
    "CorporationGoalClosed",
    "CorporationGoalCompleted",
    "CorporationGoalCreated",
    "CorporationGoalExpired",
    "CorporationGoalLimitReached",
    "CorporationGoalNameChange",
    "CorporationLeft",
    "CustomsMsg",
    "DailyItemRewardAutoClaimed",
    "DeclareWar",
    "DistrictAttacked",
    "DustAppAcceptedMsg",
    "ESSMainBankLink",
    "EntosisCaptureStarted",
    "ExpertSystemExpired",
    "ExpertSystemExpiryImminent",
    "FWAllianceKickCeoIndividualStandingWarning",
    "FWAllianceKickMsg",
    "FWAllianceKickedCeoIndividualStanding",
    "FWAllianceWarningMsg",
    "FWCharKickMsg",
    "FWCharRankGainMsg",
    "FWCharRankLossMsg",
    "FWCharWarningMsg",
    "FWCharacterKickFromCorpIndividualStandingWarning",
    "FWCharacterKickedFromCorpIndividualStanding",
    "FWCorpJoinMsg",
    "FWCorpKickMsg",
    "FWCorpLeaveMsg",
    "FWCorpWarningMsg",
    "FWCorporationKickCeoIndividualStandingWarning",
    "FWCorporationKickedCeoIndividualStanding",
    "FacWarCorpJoinRequestMsg",
    "FacWarCorpJoinWithdrawMsg",
    "FacWarCorpLeaveRequestMsg",
    "FacWarCorpLeaveWithdrawMsg",
    "FacWarDirectEnlistmentRevoked",
    "FacWarLPDisqualifiedEvent",
    "FacWarLPDisqualifiedKill",
    "FacWarLPPayoutEvent",
    "FacWarLPPayoutKill",
    "FreelanceProjectACLDeleted",
    "FreelanceProjectClosed",
    "FreelanceProjectCompleted",
    "FreelanceProjectCreated",
    "FreelanceProjectExpired",
    "FreelanceProjectLimitReached",
    "FreelanceProjectParticipantKicked",
    "GameTimeAdded",
    "GameTimeReceived",
    "GameTimeSent",
    "GiftReceived",
    "IHubDestroyedByBillFailure",
    "IncursionCompletedMsg",
    "IndustryOperationFinished",
    "IndustryTeamAuctionLost",
    "IndustryTeamAuctionWon",
    "InfrastructureHubBillAboutToExpire",
    "InsuranceExpirationMsg",
    "InsuranceFirstShipMsg",
    "InsuranceInvalidatedMsg",
    "InsuranceIssuedMsg",
    "InsurancePayoutMsg",
    "InvasionCompletedMsg",
    "InvasionSystemLogin",
    "InvasionSystemStart",
    "JumpCloneDeletedMsg1",
    "JumpCloneDeletedMsg2",
    "KillReportFinalBlow",
    "KillReportVictim",
    "KillRightAvailable",
    "KillRightAvailableOpen",
    "KillRightEarned",
    "KillRightUnavailable",
    "KillRightUnavailableOpen",
    "KillRightUsed",
    "LPAutoRedeemed",
    "LocateCharMsg",
    "MadeWarMutual",
    "MercOfferRetractedMsg",
    "MercOfferedNegotiationMsg",
    "MercenaryDenAttacked",
    "MercenaryDenNewMTO",
    "MercenaryDenReinforced",
    "MissionCanceledTriglavian",
    "MissionOfferExpirationMsg",
    "MissionTimeoutMsg",
    "MoonminingAutomaticFracture",
    "MoonminingExtractionCancelled",
    "MoonminingExtractionFinished",
    "MoonminingExtractionStarted",
    "MoonminingLaserFired",
    "MutualWarExpired",
    "MutualWarInviteAccepted",
    "MutualWarInviteRejected",
    "MutualWarInviteSent",
    "NPCStandingsGained",
    "NPCStandingsLost",
    "OfferToAllyRetracted",
    "OfferedSurrender",
    "OfferedToAlly",
    "OfficeLeaseCanceledInsufficientStandings",
    "OldLscMessages",
    "OperationFinished",
    "OrbitalAttacked",
    "OrbitalReinforced",
    "OwnershipTransferred",
    "RaffleCreated",
    "RaffleExpired",
    "RaffleFinished",
    "ReimbursementMsg",
    "ResearchMissionAvailableMsg",
    "RetractsWar",
    "SPAutoRedeemed",
    "SeasonalChallengeCompleted",
    "SkinSequencingCompleted",
    "SkyhookDeployed",
    "SkyhookDestroyed",
    "SkyhookLostShields",
    "SkyhookOnline",
    "SkyhookUnderAttack",
    "SovAllClaimAquiredMsg",
    "SovAllClaimLostMsg",
    "SovCommandNodeEventStarted",
    "SovCorpBillLateMsg",
    "SovCorpClaimFailMsg",
    "SovDisruptorMsg",
    "SovStationEnteredFreeport",
    "SovStructureDestroyed",
    "SovStructureReinforced",
    "SovStructureSelfDestructCancel",
    "SovStructureSelfDestructFinished",
    "SovStructureSelfDestructRequested",
    "SovereigntyIHDamageMsg",
    "SovereigntySBUDamageMsg",
    "SovereigntyTCUDamageMsg",
    "StationAggressionMsg1",
    "StationAggressionMsg2",
    "StationConquerMsg",
    "StationServiceDisabled",
    "StationServiceEnabled",
    "StationStateChangeMsg",
    "StoryLineMissionAvailableMsg",
    "StructureAnchoring",
    "StructureCourierContractChanged",
    "StructureDestroyed",
    "StructureFuelAlert",
    "StructureImpendingAbandonmentAssetsAtRisk",
    "StructureItemsDelivered",
    "StructureItemsMovedToSafety",
    "StructureLostArmor",
    "StructureLostShields",
    "StructureLowReagentsAlert",
    "StructureNoReagentsAlert",
    "StructureOnline",
    "StructurePaintPurchased",
    "StructureServicesOffline",
    "StructureUnanchoring",
    "StructureUnderAttack",
    "StructureWentHighPower",
    "StructureWentLowPower",
    "StructuresJobsCancelled",
    "StructuresJobsPaused",
    "StructuresReinforcementChanged",
    "TowerAlertMsg",
    "TowerResourceAlertMsg",
    "TransactionReversalMsg",
    "TutorialMsg",
    "WarAdopted ",
    "WarAllyInherited",
    "WarAllyOfferDeclinedMsg",
    "WarConcordInvalidates",
    "WarDeclared",
    "WarEndedHqSecurityDrop",
    "WarHQRemovedFromSpace",
    "WarInherited",
    "WarInvalid",
    "WarRetracted",
    "WarRetractedByConcord",
    "WarSurrenderDeclinedMsg",
    "WarSurrenderOfferMsg"
  ])
}));
const zCharactersCharacterIdOnlineGet = z.looseObject({
  last_login: z.iso.datetime({ offset: true }).optional(),
  last_logout: z.iso.datetime({ offset: true }).optional(),
  logins: z.int().optional(),
  online: z.boolean()
});
const zCharactersCharacterIdOrdersGet = z.array(z.looseObject({
  duration: z.int(),
  escrow: z.number().optional(),
  is_buy_order: z.boolean().optional(),
  is_corporation: z.boolean(),
  issued: z.iso.datetime({ offset: true }),
  location_id: z.int(),
  min_volume: z.int().optional(),
  order_id: z.int(),
  price: z.number(),
  range: z.enum([
    "1",
    "10",
    "2",
    "20",
    "3",
    "30",
    "4",
    "40",
    "5",
    "region",
    "solarsystem",
    "station"
  ]),
  region_id: z.int(),
  type_id: z.int(),
  volume_remain: z.int(),
  volume_total: z.int()
}));
const zCharactersCharacterIdOrdersHistoryGet = z.array(z.looseObject({
  duration: z.int(),
  escrow: z.number().optional(),
  is_buy_order: z.boolean().optional(),
  is_corporation: z.boolean(),
  issued: z.iso.datetime({ offset: true }),
  location_id: z.int(),
  min_volume: z.int().optional(),
  order_id: z.int(),
  price: z.number(),
  range: z.enum([
    "1",
    "10",
    "2",
    "20",
    "3",
    "30",
    "4",
    "40",
    "5",
    "region",
    "solarsystem",
    "station"
  ]),
  region_id: z.int(),
  state: z.enum(["cancelled", "expired"]),
  type_id: z.int(),
  volume_remain: z.int(),
  volume_total: z.int()
}));
const zCharactersCharacterIdPlanetsGet = z.array(z.looseObject({
  last_update: z.iso.datetime({ offset: true }),
  num_pins: z.int(),
  owner_id: z.int(),
  planet_id: z.int(),
  planet_type: z.enum([
    "temperate",
    "barren",
    "oceanic",
    "ice",
    "gas",
    "lava",
    "storm",
    "plasma"
  ]),
  solar_system_id: z.int(),
  upgrade_level: z.int()
}));
const zCharactersCharacterIdPlanetsPlanetIdGet = z.looseObject({
  links: z.array(z.looseObject({
    destination_pin_id: z.int(),
    link_level: z.int(),
    source_pin_id: z.int()
  })),
  pins: z.array(z.looseObject({
    contents: z.array(z.looseObject({
      amount: z.int(),
      type_id: z.int()
    })).optional(),
    expiry_time: z.iso.datetime({ offset: true }).optional(),
    extractor_details: z.looseObject({
      cycle_time: z.int().optional(),
      head_radius: z.number().optional(),
      heads: z.array(z.looseObject({
        head_id: z.int(),
        latitude: z.number(),
        longitude: z.number()
      })),
      product_type_id: z.int().optional(),
      qty_per_cycle: z.int().optional()
    }).optional(),
    factory_details: z.looseObject({
      schematic_id: z.int()
    }).optional(),
    install_time: z.iso.datetime({ offset: true }).optional(),
    last_cycle_start: z.iso.datetime({ offset: true }).optional(),
    latitude: z.number(),
    longitude: z.number(),
    pin_id: z.int(),
    schematic_id: z.int().optional(),
    type_id: z.int()
  })),
  routes: z.array(z.looseObject({
    content_type_id: z.int(),
    destination_pin_id: z.int(),
    quantity: z.number(),
    route_id: z.int(),
    source_pin_id: z.int(),
    waypoints: z.array(z.int()).optional()
  }))
});
const zCharactersCharacterIdPortraitGet = z.looseObject({
  px128x128: z.string().optional(),
  px256x256: z.string().optional(),
  px512x512: z.string().optional(),
  px64x64: z.string().optional()
});
const zCharactersCharacterIdRolesGet = z.looseObject({
  roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_base: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_hq: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_other: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional()
});
const zCharactersCharacterIdSearchGet = z.looseObject({
  agent: z.array(z.int()).optional(),
  alliance: z.array(z.int()).optional(),
  character: z.array(z.int()).optional(),
  constellation: z.array(z.int()).optional(),
  corporation: z.array(z.int()).optional(),
  faction: z.array(z.int()).optional(),
  inventory_type: z.array(z.int()).optional(),
  region: z.array(z.int()).optional(),
  solar_system: z.array(z.int()).optional(),
  station: z.array(z.int()).optional(),
  structure: z.array(z.int()).optional()
});
const zCharactersCharacterIdShipGet = z.looseObject({
  ship_item_id: z.int(),
  ship_name: z.string(),
  ship_type_id: z.int()
});
const zCharactersCharacterIdStandingsGet = z.array(z.looseObject({
  from_id: z.int(),
  from_type: z.enum([
    "agent",
    "npc_corp",
    "faction"
  ]),
  standing: z.number()
}));
const zCharactersCharacterIdTitlesGet = z.array(z.looseObject({
  name: z.string().optional(),
  title_id: z.int().optional()
}));
const zCharactersCharacterIdWalletGet = z.number();
const zCharactersCharacterIdWalletJournalGet = z.array(z.looseObject({
  amount: z.number().optional(),
  balance: z.number().optional(),
  context_id: z.int().optional(),
  context_id_type: z.enum([
    "structure_id",
    "station_id",
    "market_transaction_id",
    "character_id",
    "corporation_id",
    "alliance_id",
    "eve_system",
    "industry_job_id",
    "contract_id",
    "planet_id",
    "system_id",
    "type_id"
  ]).optional(),
  date: z.iso.datetime({ offset: true }),
  description: z.string(),
  first_party_id: z.int().optional(),
  id: z.int(),
  reason: z.string().optional(),
  ref_type: z.enum([
    "acceleration_gate_fee",
    "achievement_category_milestone_reward",
    "achievement_milestone_reward",
    "advertisement_listing_fee",
    "agent_donation",
    "agent_location_services",
    "agent_miscellaneous",
    "agent_mission_collateral_paid",
    "agent_mission_collateral_refunded",
    "agent_mission_reward",
    "agent_mission_reward_corporation_tax",
    "agent_mission_security_tax",
    "agent_mission_time_bonus_reward",
    "agent_mission_time_bonus_reward_corporation_tax",
    "agent_security_services",
    "agent_services_rendered",
    "agents_preward",
    "air_career_program_reward",
    "alliance_maintainance_fee",
    "alliance_registration_fee",
    "allignment_based_gate_toll",
    "asset_safety_recovery_tax",
    "bounty",
    "bounty_prize",
    "bounty_prize_corporation_tax",
    "bounty_prizes",
    "bounty_reimbursement",
    "bounty_surcharge",
    "brokers_fee",
    "campaign_objective_isk_reward",
    "clone_activation",
    "clone_transfer",
    "contraband_fine",
    "contract_auction_bid",
    "contract_auction_bid_corp",
    "contract_auction_bid_refund",
    "contract_auction_sold",
    "contract_brokers_fee",
    "contract_brokers_fee_corp",
    "contract_collateral",
    "contract_collateral_deposited_corp",
    "contract_collateral_payout",
    "contract_collateral_refund",
    "contract_deposit",
    "contract_deposit_corp",
    "contract_deposit_refund",
    "contract_deposit_sales_tax",
    "contract_price",
    "contract_price_payment_corp",
    "contract_reversal",
    "contract_reward",
    "contract_reward_deposited",
    "contract_reward_deposited_corp",
    "contract_reward_refund",
    "contract_sales_tax",
    "copying",
    "corporate_reward_payout",
    "corporate_reward_tax",
    "corporation_account_withdrawal",
    "corporation_bulk_payment",
    "corporation_dividend_payment",
    "corporation_liquidation",
    "corporation_logo_change_cost",
    "corporation_payment",
    "corporation_registration_fee",
    "cosmetic_market_component_item_purchase",
    "cosmetic_market_skin_purchase",
    "cosmetic_market_skin_sale",
    "cosmetic_market_skin_sale_broker_fee",
    "cosmetic_market_skin_sale_tax",
    "cosmetic_market_skin_transaction",
    "courier_mission_escrow",
    "cspa",
    "cspaofflinerefund",
    "daily_challenge_reward",
    "daily_goal_payouts",
    "daily_goal_payouts_tax",
    "datacore_fee",
    "dna_modification_fee",
    "docking_fee",
    "duel_wager_escrow",
    "duel_wager_payment",
    "duel_wager_refund",
    "ess_escrow_transfer",
    "external_trade_delivery",
    "external_trade_freeze",
    "external_trade_thaw",
    "factory_slot_rental_fee",
    "flux_payout",
    "flux_tax",
    "flux_ticket_repayment",
    "flux_ticket_sale",
    "freelance_jobs_broadcasting_fee",
    "freelance_jobs_duration_fee",
    "freelance_jobs_escrow_refund",
    "freelance_jobs_reward",
    "freelance_jobs_reward_corporation_tax",
    "freelance_jobs_reward_escrow",
    "gm_cash_transfer",
    "gm_plex_fee_refund",
    "industry_job_tax",
    "industry_security_tax",
    "infrastructure_hub_maintenance",
    "inheritance",
    "insurance",
    "insurgency_corruption_contribution_reward",
    "insurgency_suppression_contribution_reward",
    "item_trader_payment",
    "jump_clone_activation_fee",
    "jump_clone_installation_fee",
    "kill_right_fee",
    "lp_store",
    "manufacturing",
    "market_escrow",
    "market_fine_paid",
    "market_provider_tax",
    "market_security_tax",
    "market_transaction",
    "medal_creation",
    "medal_issued",
    "milestone_reward_payment",
    "mission_completion",
    "mission_cost",
    "mission_expiration",
    "mission_reward",
    "npc_bounty_security_tax",
    "office_rental_fee",
    "operation_bonus",
    "opportunity_reward",
    "planetary_construction",
    "planetary_export_tax",
    "planetary_import_tax",
    "player_donation",
    "player_trading",
    "project_discovery_reward",
    "project_discovery_tax",
    "project_payouts",
    "reaction",
    "redeemed_isk_token",
    "release_of_impounded_property",
    "repair_bill",
    "reprocessing_tax",
    "researching_material_productivity",
    "researching_technology",
    "researching_time_productivity",
    "resource_wars_reward",
    "reverse_engineering",
    "season_challenge_reward",
    "security_processing_fee",
    "shares",
    "skill_purchase",
    "skyhook_claim_fee",
    "sovereignity_bill",
    "store_purchase",
    "store_purchase_refund",
    "structure_gate_jump",
    "transaction_tax",
    "under_construction",
    "upkeep_adjustment_fee",
    "war_ally_contract",
    "war_fee",
    "war_fee_surrender"
  ]),
  second_party_id: z.int().optional(),
  tax: z.number().optional(),
  tax_receiver_id: z.int().optional()
}));
const zCharactersCharacterIdWalletTransactionsGet = z.array(z.looseObject({
  client_id: z.int(),
  date: z.iso.datetime({ offset: true }),
  is_buy: z.boolean(),
  is_personal: z.boolean(),
  journal_ref_id: z.int(),
  location_id: z.int(),
  quantity: z.int(),
  transaction_id: z.int(),
  type_id: z.int(),
  unit_price: z.number()
}));
const zCharactersCosmeticsSkinrComponentsItem = z.looseObject({
  component_id: z.int(),
  runs: z.xor([
    z.looseObject({
      remaining: z.int().optional()
    }),
    z.looseObject({
      unlimited: z.boolean().optional()
    })
  ]),
  type: z.enum(["nanocoating", "pattern"])
});
const zCharactersCosmeticsSkinrComponents = z.looseObject({
  licenses: z.array(zCharactersCosmeticsSkinrComponentsItem)
});
const zCharactersCosmeticsSkinrItem = z.looseObject({
  activated: z.boolean(),
  skinr_id: z.string(),
  unactivated: z.int()
});
const zCharactersCosmeticsSkinr = z.looseObject({
  licenses: z.array(zCharactersCosmeticsSkinrItem)
});
const zCharactersFreelanceJobsParticipation = z.looseObject({
  contributed: z.int(),
  last_modified: z.iso.datetime({ offset: true }),
  state: z.enum([
    "Unspecified",
    "Committed",
    "Kicked",
    "Resigned"
  ])
});
const zCharactersSkillsSkill = z.looseObject({
  active_skill_level: z.int(),
  skill_id: z.int(),
  skillpoints_in_skill: z.int(),
  trained_skill_level: z.int()
});
const zCharactersSkills = z.looseObject({
  skills: z.array(zCharactersSkillsSkill),
  total_sp: z.int(),
  unallocated_sp: z.int().optional()
});
const zCharactersStructuresMercenaryDensDetailEvolutionanarchy = z.looseObject({
  amount: z.int(),
  level: z.enum([
    "Unspecified",
    "Level0",
    "Level1",
    "Level2",
    "Level3",
    "Level4"
  ])
});
const zCharactersStructuresMercenaryDensDetailEvolutiondevelopment = z.looseObject({
  amount: z.int(),
  level: z.enum([
    "Unspecified",
    "Level0",
    "Level1",
    "Level2",
    "Level3",
    "Level4"
  ])
});
const zCharactersStructuresMercenaryDensDetailEvolution = z.looseObject({
  anarchy: zCharactersStructuresMercenaryDensDetailEvolutionanarchy,
  development: zCharactersStructuresMercenaryDensDetailEvolutiondevelopment
});
const zCharactersStructuresMercenaryDensDetailInfomorphs = z.looseObject({
  amount: z.int()
});
const zCharactersStructuresMercenaryDensDetailReinforcementtimer = z.looseObject({
  end: z.iso.datetime({ offset: true })
});
const zCompatibilityDate = z.iso.date();
const zConstellationId = z.int();
const zContractsPublicBidsContractIdGet = z.array(z.looseObject({
  amount: z.number(),
  bid_id: z.int(),
  date_bid: z.iso.datetime({ offset: true })
}));
const zContractsPublicItemsContractIdGet = z.array(z.looseObject({
  is_blueprint_copy: z.boolean().optional(),
  is_included: z.boolean(),
  item_id: z.int().optional(),
  material_efficiency: z.int().optional(),
  quantity: z.int(),
  record_id: z.int(),
  runs: z.int().optional(),
  time_efficiency: z.int().optional(),
  type_id: z.int()
}));
const zContractsPublicRegionIdGet = z.array(z.looseObject({
  buyout: z.number().optional(),
  collateral: z.number().optional(),
  contract_id: z.int(),
  date_expired: z.iso.datetime({ offset: true }),
  date_issued: z.iso.datetime({ offset: true }),
  days_to_complete: z.int().optional(),
  end_location_id: z.int().optional(),
  for_corporation: z.boolean().optional(),
  issuer_corporation_id: z.int(),
  issuer_id: z.int(),
  price: z.number().optional(),
  reward: z.number().optional(),
  start_location_id: z.int().optional(),
  title: z.string().optional(),
  type: z.enum([
    "unknown",
    "item_exchange",
    "auction",
    "courier",
    "loan"
  ]),
  volume: z.number().optional()
}));
const zCorporationCorporationIdMiningExtractionsGet = z.array(z.looseObject({
  chunk_arrival_time: z.iso.datetime({ offset: true }),
  extraction_start_time: z.iso.datetime({ offset: true }),
  moon_id: z.int(),
  natural_decay_time: z.iso.datetime({ offset: true }),
  structure_id: z.int()
}));
const zCorporationCorporationIdMiningObserversGet = z.array(z.looseObject({
  last_updated: z.iso.date(),
  observer_id: z.int(),
  observer_type: z.enum(["structure"])
}));
const zCorporationCorporationIdMiningObserversObserverIdGet = z.array(z.looseObject({
  character_id: z.int(),
  last_updated: z.iso.date(),
  quantity: z.int(),
  recorded_corporation_id: z.int(),
  type_id: z.int()
}));
const zCorporationId = z.int();
const zCharactersAccessListsDetailCorporationentry = z.looseObject({
  access: z.enum([
    "Unspecified",
    "Allowed",
    "Blocked",
    "Manager",
    "Admin"
  ]),
  corporation_id: zCorporationId
});
const zCharactersAccessListsDetailMembership = z.looseObject({
  alliances: z.array(zCharactersAccessListsDetailAllianceentry),
  allow_everyone: z.boolean(),
  characters: z.array(zCharactersAccessListsDetailCharacterentry),
  corporations: z.array(zCharactersAccessListsDetailCorporationentry)
});
const zCharactersAccessListsDetail = z.looseObject({
  description: z.string(),
  id: zAccessListId,
  membership: zCharactersAccessListsDetailMembership,
  name: z.string()
});
const zCorporationsCorporationIdAlliancehistoryGet = z.array(z.looseObject({
  alliance_id: z.int().optional(),
  is_deleted: z.boolean().optional(),
  record_id: z.int(),
  start_date: z.iso.datetime({ offset: true })
}));
const zCorporationsCorporationIdAssetsGet = z.array(z.looseObject({
  is_blueprint_copy: z.boolean().optional(),
  is_singleton: z.boolean(),
  item_id: z.int(),
  location_flag: z.enum([
    "AssetSafety",
    "AutoFit",
    "Bonus",
    "Booster",
    "BoosterBay",
    "Capsule",
    "CapsuleerDeliveries",
    "Cargo",
    "CorpDeliveries",
    "CorpSAG1",
    "CorpSAG2",
    "CorpSAG3",
    "CorpSAG4",
    "CorpSAG5",
    "CorpSAG6",
    "CorpSAG7",
    "CorporationGoalDeliveries",
    "CrateLoot",
    "Deliveries",
    "DroneBay",
    "DustBattle",
    "DustDatabank",
    "ExpeditionHold",
    "FighterBay",
    "FighterTube0",
    "FighterTube1",
    "FighterTube2",
    "FighterTube3",
    "FighterTube4",
    "FleetHangar",
    "FrigateEscapeBay",
    "Hangar",
    "HangarAll",
    "HiSlot0",
    "HiSlot1",
    "HiSlot2",
    "HiSlot3",
    "HiSlot4",
    "HiSlot5",
    "HiSlot6",
    "HiSlot7",
    "HiddenModifiers",
    "Implant",
    "Impounded",
    "InfrastructureHangar",
    "JunkyardReprocessed",
    "JunkyardTrashed",
    "LoSlot0",
    "LoSlot1",
    "LoSlot2",
    "LoSlot3",
    "LoSlot4",
    "LoSlot5",
    "LoSlot6",
    "LoSlot7",
    "Locked",
    "MedSlot0",
    "MedSlot1",
    "MedSlot2",
    "MedSlot3",
    "MedSlot4",
    "MedSlot5",
    "MedSlot6",
    "MedSlot7",
    "MobileDepotHold",
    "MoonMaterialBay",
    "OfficeFolder",
    "Pilot",
    "PlanetSurface",
    "QuafeBay",
    "QuantumCoreRoom",
    "Reward",
    "RigSlot0",
    "RigSlot1",
    "RigSlot2",
    "RigSlot3",
    "RigSlot4",
    "RigSlot5",
    "RigSlot6",
    "RigSlot7",
    "SecondaryStorage",
    "ServiceSlot0",
    "ServiceSlot1",
    "ServiceSlot2",
    "ServiceSlot3",
    "ServiceSlot4",
    "ServiceSlot5",
    "ServiceSlot6",
    "ServiceSlot7",
    "ShipHangar",
    "ShipOffline",
    "Skill",
    "SkillInTraining",
    "SpecializedAmmoHold",
    "SpecializedAsteroidHold",
    "SpecializedCommandCenterHold",
    "SpecializedFuelBay",
    "SpecializedGasHold",
    "SpecializedIceHold",
    "SpecializedIndustrialShipHold",
    "SpecializedLargeShipHold",
    "SpecializedMaterialBay",
    "SpecializedMediumShipHold",
    "SpecializedMineralHold",
    "SpecializedOreHold",
    "SpecializedPlanetaryCommoditiesHold",
    "SpecializedSalvageHold",
    "SpecializedShipHold",
    "SpecializedSmallShipHold",
    "StructureActive",
    "StructureFuel",
    "StructureInactive",
    "StructureOffline",
    "SubSystemBay",
    "SubSystemSlot0",
    "SubSystemSlot1",
    "SubSystemSlot2",
    "SubSystemSlot3",
    "SubSystemSlot4",
    "SubSystemSlot5",
    "SubSystemSlot6",
    "SubSystemSlot7",
    "Unlocked",
    "Wallet",
    "Wardrobe"
  ]),
  location_id: z.int(),
  location_type: z.enum([
    "station",
    "solar_system",
    "item",
    "other"
  ]),
  quantity: z.int(),
  type_id: z.int()
}));
const zCorporationsCorporationIdAssetsLocationsPost = z.array(z.looseObject({
  item_id: z.int(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  })
}));
const zCorporationsCorporationIdAssetsNamesPost = z.array(z.looseObject({
  item_id: z.int(),
  name: z.string()
}));
const zCorporationsCorporationIdBlueprintsGet = z.array(z.looseObject({
  item_id: z.int(),
  location_flag: z.enum([
    "AssetSafety",
    "AutoFit",
    "Bonus",
    "Booster",
    "BoosterBay",
    "Capsule",
    "CapsuleerDeliveries",
    "Cargo",
    "CorpDeliveries",
    "CorpSAG1",
    "CorpSAG2",
    "CorpSAG3",
    "CorpSAG4",
    "CorpSAG5",
    "CorpSAG6",
    "CorpSAG7",
    "CorporationGoalDeliveries",
    "CrateLoot",
    "Deliveries",
    "DroneBay",
    "DustBattle",
    "DustDatabank",
    "ExpeditionHold",
    "FighterBay",
    "FighterTube0",
    "FighterTube1",
    "FighterTube2",
    "FighterTube3",
    "FighterTube4",
    "FleetHangar",
    "FrigateEscapeBay",
    "Hangar",
    "HangarAll",
    "HiSlot0",
    "HiSlot1",
    "HiSlot2",
    "HiSlot3",
    "HiSlot4",
    "HiSlot5",
    "HiSlot6",
    "HiSlot7",
    "HiddenModifiers",
    "Implant",
    "Impounded",
    "InfrastructureHangar",
    "JunkyardReprocessed",
    "JunkyardTrashed",
    "LoSlot0",
    "LoSlot1",
    "LoSlot2",
    "LoSlot3",
    "LoSlot4",
    "LoSlot5",
    "LoSlot6",
    "LoSlot7",
    "Locked",
    "MedSlot0",
    "MedSlot1",
    "MedSlot2",
    "MedSlot3",
    "MedSlot4",
    "MedSlot5",
    "MedSlot6",
    "MedSlot7",
    "MobileDepotHold",
    "MoonMaterialBay",
    "OfficeFolder",
    "Pilot",
    "PlanetSurface",
    "QuafeBay",
    "QuantumCoreRoom",
    "Reward",
    "RigSlot0",
    "RigSlot1",
    "RigSlot2",
    "RigSlot3",
    "RigSlot4",
    "RigSlot5",
    "RigSlot6",
    "RigSlot7",
    "SecondaryStorage",
    "ServiceSlot0",
    "ServiceSlot1",
    "ServiceSlot2",
    "ServiceSlot3",
    "ServiceSlot4",
    "ServiceSlot5",
    "ServiceSlot6",
    "ServiceSlot7",
    "ShipHangar",
    "ShipOffline",
    "Skill",
    "SkillInTraining",
    "SpecializedAmmoHold",
    "SpecializedAsteroidHold",
    "SpecializedCommandCenterHold",
    "SpecializedFuelBay",
    "SpecializedGasHold",
    "SpecializedIceHold",
    "SpecializedIndustrialShipHold",
    "SpecializedLargeShipHold",
    "SpecializedMaterialBay",
    "SpecializedMediumShipHold",
    "SpecializedMineralHold",
    "SpecializedOreHold",
    "SpecializedPlanetaryCommoditiesHold",
    "SpecializedSalvageHold",
    "SpecializedShipHold",
    "SpecializedSmallShipHold",
    "StructureActive",
    "StructureFuel",
    "StructureInactive",
    "StructureOffline",
    "SubSystemBay",
    "SubSystemSlot0",
    "SubSystemSlot1",
    "SubSystemSlot2",
    "SubSystemSlot3",
    "SubSystemSlot4",
    "SubSystemSlot5",
    "SubSystemSlot6",
    "SubSystemSlot7",
    "Unlocked",
    "Wallet",
    "Wardrobe"
  ]),
  location_id: z.int(),
  material_efficiency: z.int(),
  quantity: z.int(),
  runs: z.int(),
  time_efficiency: z.int(),
  type_id: z.int()
}));
const zCorporationsCorporationIdContactsGet = z.array(z.looseObject({
  contact_id: z.int(),
  contact_type: z.enum([
    "character",
    "corporation",
    "alliance",
    "faction"
  ]),
  is_watched: z.boolean().optional(),
  label_ids: z.array(z.int()).optional(),
  standing: z.number()
}));
const zCorporationsCorporationIdContactsLabelsGet = z.array(z.looseObject({
  label_id: z.int(),
  label_name: z.string()
}));
const zCorporationsCorporationIdContainersLogsGet = z.array(z.looseObject({
  action: z.enum([
    "add",
    "assemble",
    "configure",
    "enter_password",
    "lock",
    "move",
    "repackage",
    "set_name",
    "set_password",
    "unlock"
  ]),
  character_id: z.int(),
  container_id: z.int(),
  container_type_id: z.int(),
  location_flag: z.enum([
    "AssetSafety",
    "AutoFit",
    "Bonus",
    "Booster",
    "BoosterBay",
    "Capsule",
    "CapsuleerDeliveries",
    "Cargo",
    "CorpDeliveries",
    "CorpSAG1",
    "CorpSAG2",
    "CorpSAG3",
    "CorpSAG4",
    "CorpSAG5",
    "CorpSAG6",
    "CorpSAG7",
    "CorporationGoalDeliveries",
    "CrateLoot",
    "Deliveries",
    "DroneBay",
    "DustBattle",
    "DustDatabank",
    "ExpeditionHold",
    "FighterBay",
    "FighterTube0",
    "FighterTube1",
    "FighterTube2",
    "FighterTube3",
    "FighterTube4",
    "FleetHangar",
    "FrigateEscapeBay",
    "Hangar",
    "HangarAll",
    "HiSlot0",
    "HiSlot1",
    "HiSlot2",
    "HiSlot3",
    "HiSlot4",
    "HiSlot5",
    "HiSlot6",
    "HiSlot7",
    "HiddenModifiers",
    "Implant",
    "Impounded",
    "InfrastructureHangar",
    "JunkyardReprocessed",
    "JunkyardTrashed",
    "LoSlot0",
    "LoSlot1",
    "LoSlot2",
    "LoSlot3",
    "LoSlot4",
    "LoSlot5",
    "LoSlot6",
    "LoSlot7",
    "Locked",
    "MedSlot0",
    "MedSlot1",
    "MedSlot2",
    "MedSlot3",
    "MedSlot4",
    "MedSlot5",
    "MedSlot6",
    "MedSlot7",
    "MobileDepotHold",
    "MoonMaterialBay",
    "OfficeFolder",
    "Pilot",
    "PlanetSurface",
    "QuafeBay",
    "QuantumCoreRoom",
    "Reward",
    "RigSlot0",
    "RigSlot1",
    "RigSlot2",
    "RigSlot3",
    "RigSlot4",
    "RigSlot5",
    "RigSlot6",
    "RigSlot7",
    "SecondaryStorage",
    "ServiceSlot0",
    "ServiceSlot1",
    "ServiceSlot2",
    "ServiceSlot3",
    "ServiceSlot4",
    "ServiceSlot5",
    "ServiceSlot6",
    "ServiceSlot7",
    "ShipHangar",
    "ShipOffline",
    "Skill",
    "SkillInTraining",
    "SpecializedAmmoHold",
    "SpecializedAsteroidHold",
    "SpecializedCommandCenterHold",
    "SpecializedFuelBay",
    "SpecializedGasHold",
    "SpecializedIceHold",
    "SpecializedIndustrialShipHold",
    "SpecializedLargeShipHold",
    "SpecializedMaterialBay",
    "SpecializedMediumShipHold",
    "SpecializedMineralHold",
    "SpecializedOreHold",
    "SpecializedPlanetaryCommoditiesHold",
    "SpecializedSalvageHold",
    "SpecializedShipHold",
    "SpecializedSmallShipHold",
    "StructureActive",
    "StructureFuel",
    "StructureInactive",
    "StructureOffline",
    "SubSystemBay",
    "SubSystemSlot0",
    "SubSystemSlot1",
    "SubSystemSlot2",
    "SubSystemSlot3",
    "SubSystemSlot4",
    "SubSystemSlot5",
    "SubSystemSlot6",
    "SubSystemSlot7",
    "Unlocked",
    "Wallet",
    "Wardrobe"
  ]),
  location_id: z.int(),
  logged_at: z.iso.datetime({ offset: true }),
  new_config_bitmask: z.int().optional(),
  old_config_bitmask: z.int().optional(),
  password_type: z.enum(["config", "general"]).optional(),
  quantity: z.int().optional(),
  type_id: z.int().optional()
}));
const zCorporationsCorporationIdContractsContractIdBidsGet = z.array(z.looseObject({
  amount: z.number(),
  bid_id: z.int(),
  bidder_id: z.int(),
  date_bid: z.iso.datetime({ offset: true })
}));
const zCorporationsCorporationIdContractsContractIdItemsGet = z.array(z.looseObject({
  is_included: z.boolean(),
  is_singleton: z.boolean(),
  quantity: z.int(),
  raw_quantity: z.int().optional(),
  record_id: z.int(),
  type_id: z.int()
}));
const zCorporationsCorporationIdContractsGet = z.array(z.looseObject({
  acceptor_id: z.int(),
  assignee_id: z.int(),
  availability: z.enum([
    "public",
    "personal",
    "corporation",
    "alliance"
  ]),
  buyout: z.number().optional(),
  collateral: z.number().optional(),
  contract_id: z.int(),
  date_accepted: z.iso.datetime({ offset: true }).optional(),
  date_completed: z.iso.datetime({ offset: true }).optional(),
  date_expired: z.iso.datetime({ offset: true }),
  date_issued: z.iso.datetime({ offset: true }),
  days_to_complete: z.int().optional(),
  end_location_id: z.int().optional(),
  for_corporation: z.boolean(),
  issuer_corporation_id: z.int(),
  issuer_id: z.int(),
  price: z.number().optional(),
  reward: z.number().optional(),
  start_location_id: z.int().optional(),
  status: z.enum([
    "outstanding",
    "in_progress",
    "finished_issuer",
    "finished_contractor",
    "finished",
    "cancelled",
    "rejected",
    "failed",
    "deleted",
    "reversed"
  ]),
  title: z.string().optional(),
  type: z.enum([
    "unknown",
    "item_exchange",
    "auction",
    "courier",
    "loan"
  ]),
  volume: z.number().optional()
}));
const zCorporationsCorporationIdCustomsOfficesGet = z.array(z.looseObject({
  alliance_tax_rate: z.number().optional(),
  allow_access_with_standings: z.boolean(),
  allow_alliance_access: z.boolean(),
  bad_standing_tax_rate: z.number().optional(),
  corporation_tax_rate: z.number().optional(),
  excellent_standing_tax_rate: z.number().optional(),
  good_standing_tax_rate: z.number().optional(),
  neutral_standing_tax_rate: z.number().optional(),
  office_id: z.int(),
  reinforce_exit_end: z.int(),
  reinforce_exit_start: z.int(),
  standing_level: z.enum([
    "bad",
    "excellent",
    "good",
    "neutral",
    "terrible"
  ]).optional(),
  system_id: z.int(),
  terrible_standing_tax_rate: z.number().optional(),
  type_id: z.int().optional()
}));
const zCorporationsCorporationIdDivisionsGet = z.looseObject({
  hangar: z.array(z.looseObject({
    division: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  wallet: z.array(z.looseObject({
    division: z.int().optional(),
    name: z.string().optional()
  })).optional()
});
const zCorporationsCorporationIdFacilitiesGet = z.array(z.looseObject({
  facility_id: z.int(),
  system_id: z.int(),
  type_id: z.int()
}));
const zCorporationsCorporationIdFwStatsGet = z.looseObject({
  enlisted_on: z.iso.datetime({ offset: true }).optional(),
  faction_id: z.int().optional(),
  kills: z.looseObject({
    last_week: z.int(),
    total: z.int(),
    yesterday: z.int()
  }),
  pilots: z.int().optional(),
  victory_points: z.looseObject({
    last_week: z.int(),
    total: z.int(),
    yesterday: z.int()
  })
});
const zCorporationsCorporationIdIconsGet = z.looseObject({
  px128x128: z.string().optional(),
  px256x256: z.string().optional(),
  px64x64: z.string().optional()
});
const zCorporationsCorporationIdIndustryJobsGet = z.array(z.looseObject({
  activity_id: z.int(),
  blueprint_id: z.int(),
  blueprint_location_id: z.int(),
  blueprint_type_id: z.int(),
  completed_character_id: z.int().optional(),
  completed_date: z.iso.datetime({ offset: true }).optional(),
  cost: z.number().optional(),
  duration: z.int(),
  end_date: z.iso.datetime({ offset: true }),
  facility_id: z.int(),
  installer_id: z.int(),
  job_id: z.int(),
  licensed_runs: z.int().optional(),
  location_id: z.int(),
  output_location_id: z.int(),
  pause_date: z.iso.datetime({ offset: true }).optional(),
  probability: z.number().optional(),
  product_type_id: z.int().optional(),
  runs: z.int(),
  start_date: z.iso.datetime({ offset: true }),
  status: z.enum([
    "active",
    "cancelled",
    "delivered",
    "paused",
    "ready",
    "reverted"
  ]),
  successful_runs: z.int().optional()
}));
const zCorporationsCorporationIdKillmailsRecentGet = z.array(z.looseObject({
  killmail_hash: z.string(),
  killmail_id: z.int()
}));
const zCorporationsCorporationIdMedalsGet = z.array(z.looseObject({
  created_at: z.iso.datetime({ offset: true }),
  creator_id: z.int(),
  description: z.string(),
  medal_id: z.int(),
  title: z.string()
}));
const zCorporationsCorporationIdMedalsIssuedGet = z.array(z.looseObject({
  character_id: z.int(),
  issued_at: z.iso.datetime({ offset: true }),
  issuer_id: z.int(),
  medal_id: z.int(),
  reason: z.string(),
  status: z.enum(["private", "public"])
}));
const zCorporationsCorporationIdMembersGet = z.array(z.int());
const zCorporationsCorporationIdMembersLimitGet = z.int();
const zCorporationsCorporationIdMembersTitlesGet = z.array(z.looseObject({
  character_id: z.int(),
  titles: z.array(z.int())
}));
const zCorporationsCorporationIdMembertrackingGet = z.array(z.looseObject({
  base_id: z.int().optional(),
  character_id: z.int(),
  location_id: z.int().optional(),
  logoff_date: z.iso.datetime({ offset: true }).optional(),
  logon_date: z.iso.datetime({ offset: true }).optional(),
  ship_type_id: z.int().optional(),
  start_date: z.iso.datetime({ offset: true }).optional()
}));
const zCorporationsCorporationIdOrdersGet = z.array(z.looseObject({
  duration: z.int(),
  escrow: z.number().optional(),
  is_buy_order: z.boolean().optional(),
  issued: z.iso.datetime({ offset: true }),
  issued_by: z.int(),
  location_id: z.int(),
  min_volume: z.int().optional(),
  order_id: z.int(),
  price: z.number(),
  range: z.enum([
    "1",
    "10",
    "2",
    "20",
    "3",
    "30",
    "4",
    "40",
    "5",
    "region",
    "solarsystem",
    "station"
  ]),
  region_id: z.int(),
  type_id: z.int(),
  volume_remain: z.int(),
  volume_total: z.int(),
  wallet_division: z.int()
}));
const zCorporationsCorporationIdOrdersHistoryGet = z.array(z.looseObject({
  duration: z.int(),
  escrow: z.number().optional(),
  is_buy_order: z.boolean().optional(),
  issued: z.iso.datetime({ offset: true }),
  issued_by: z.int().optional(),
  location_id: z.int(),
  min_volume: z.int().optional(),
  order_id: z.int(),
  price: z.number(),
  range: z.enum([
    "1",
    "10",
    "2",
    "20",
    "3",
    "30",
    "4",
    "40",
    "5",
    "region",
    "solarsystem",
    "station"
  ]),
  region_id: z.int(),
  state: z.enum(["cancelled", "expired"]),
  type_id: z.int(),
  volume_remain: z.int(),
  volume_total: z.int(),
  wallet_division: z.int()
}));
const zCorporationsCorporationIdRolesGet = z.array(z.looseObject({
  character_id: z.int(),
  grantable_roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  grantable_roles_at_base: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  grantable_roles_at_hq: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  grantable_roles_at_other: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_base: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_hq: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_other: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional()
}));
const zCorporationsCorporationIdRolesHistoryGet = z.array(z.looseObject({
  changed_at: z.iso.datetime({ offset: true }),
  character_id: z.int(),
  issuer_id: z.int(),
  new_roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }),
  old_roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }),
  role_type: z.enum([
    "grantable_roles",
    "grantable_roles_at_base",
    "grantable_roles_at_hq",
    "grantable_roles_at_other",
    "roles",
    "roles_at_base",
    "roles_at_hq",
    "roles_at_other"
  ])
}));
const zCorporationsCorporationIdShareholdersGet = z.array(z.looseObject({
  share_count: z.int(),
  shareholder_id: z.int(),
  shareholder_type: z.enum(["character", "corporation"])
}));
const zCorporationsCorporationIdStandingsGet = z.array(z.looseObject({
  from_id: z.int(),
  from_type: z.enum([
    "agent",
    "npc_corp",
    "faction"
  ]),
  standing: z.number()
}));
const zCorporationsCorporationIdStarbasesGet = z.array(z.looseObject({
  moon_id: z.int().optional(),
  onlined_since: z.iso.datetime({ offset: true }).optional(),
  reinforced_until: z.iso.datetime({ offset: true }).optional(),
  starbase_id: z.int(),
  state: z.enum([
    "offline",
    "online",
    "onlining",
    "reinforced",
    "unanchoring"
  ]).optional(),
  system_id: z.int(),
  type_id: z.int(),
  unanchor_at: z.iso.datetime({ offset: true }).optional()
}));
const zCorporationsCorporationIdStarbasesStarbaseIdGet = z.looseObject({
  allow_alliance_members: z.boolean(),
  allow_corporation_members: z.boolean(),
  anchor: z.enum([
    "alliance_member",
    "config_starbase_equipment_role",
    "corporation_member",
    "starbase_fuel_technician_role"
  ]),
  attack_if_at_war: z.boolean(),
  attack_if_other_security_status_dropping: z.boolean(),
  attack_security_status_threshold: z.number().optional(),
  attack_standing_threshold: z.number().optional(),
  fuel_bay_take: z.enum([
    "alliance_member",
    "config_starbase_equipment_role",
    "corporation_member",
    "starbase_fuel_technician_role"
  ]),
  fuel_bay_view: z.enum([
    "alliance_member",
    "config_starbase_equipment_role",
    "corporation_member",
    "starbase_fuel_technician_role"
  ]),
  fuels: z.array(z.looseObject({
    quantity: z.int(),
    type_id: z.int()
  })).optional(),
  offline: z.enum([
    "alliance_member",
    "config_starbase_equipment_role",
    "corporation_member",
    "starbase_fuel_technician_role"
  ]),
  online: z.enum([
    "alliance_member",
    "config_starbase_equipment_role",
    "corporation_member",
    "starbase_fuel_technician_role"
  ]),
  unanchor: z.enum([
    "alliance_member",
    "config_starbase_equipment_role",
    "corporation_member",
    "starbase_fuel_technician_role"
  ]),
  use_alliance_standings: z.boolean()
});
const zCorporationsCorporationIdStructuresGet = z.array(z.looseObject({
  corporation_id: z.int(),
  fuel_expires: z.iso.datetime({ offset: true }).optional(),
  name: z.string().optional(),
  next_reinforce_apply: z.iso.datetime({ offset: true }).optional(),
  next_reinforce_hour: z.int().optional(),
  profile_id: z.int(),
  reinforce_hour: z.int().optional(),
  services: z.array(z.looseObject({
    name: z.string(),
    state: z.enum([
      "online",
      "offline",
      "cleanup"
    ])
  })).optional(),
  state: z.enum([
    "anchor_vulnerable",
    "anchoring",
    "armor_reinforce",
    "armor_vulnerable",
    "deploy_vulnerable",
    "fitting_invulnerable",
    "hull_reinforce",
    "hull_vulnerable",
    "online_deprecated",
    "onlining_vulnerable",
    "shield_vulnerable",
    "unanchored",
    "unknown"
  ]),
  state_timer_end: z.iso.datetime({ offset: true }).optional(),
  state_timer_start: z.iso.datetime({ offset: true }).optional(),
  structure_id: z.int(),
  system_id: z.int(),
  type_id: z.int(),
  unanchors_at: z.iso.datetime({ offset: true }).optional()
}));
const zCorporationsCorporationIdTitlesGet = z.array(z.looseObject({
  grantable_roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  grantable_roles_at_base: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  grantable_roles_at_hq: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  grantable_roles_at_other: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  name: z.string().optional(),
  roles: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_base: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_hq: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  roles_at_other: z.array(z.enum([
    "Account_Take_1",
    "Account_Take_2",
    "Account_Take_3",
    "Account_Take_4",
    "Account_Take_5",
    "Account_Take_6",
    "Account_Take_7",
    "Accountant",
    "Auditor",
    "Brand_Manager",
    "Communications_Officer",
    "Config_Equipment",
    "Config_Starbase_Equipment",
    "Container_Take_1",
    "Container_Take_2",
    "Container_Take_3",
    "Container_Take_4",
    "Container_Take_5",
    "Container_Take_6",
    "Container_Take_7",
    "Contract_Manager",
    "Deliveries_Container_Take",
    "Deliveries_Query",
    "Deliveries_Take",
    "Diplomat",
    "Director",
    "Factory_Manager",
    "Fitting_Manager",
    "Hangar_Query_1",
    "Hangar_Query_2",
    "Hangar_Query_3",
    "Hangar_Query_4",
    "Hangar_Query_5",
    "Hangar_Query_6",
    "Hangar_Query_7",
    "Hangar_Take_1",
    "Hangar_Take_2",
    "Hangar_Take_3",
    "Hangar_Take_4",
    "Hangar_Take_5",
    "Hangar_Take_6",
    "Hangar_Take_7",
    "Junior_Accountant",
    "Personnel_Manager",
    "Project_Manager",
    "Rent_Factory_Facility",
    "Rent_Office",
    "Rent_Research_Facility",
    "Security_Officer",
    "Skill_Plan_Manager",
    "Starbase_Defense_Operator",
    "Starbase_Fuel_Technician",
    "Station_Manager",
    "Trader"
  ])).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  title_id: z.int().optional()
}));
const zCorporationsCorporationIdWalletsDivisionJournalGet = z.array(z.looseObject({
  amount: z.number().optional(),
  balance: z.number().optional(),
  context_id: z.int().optional(),
  context_id_type: z.enum([
    "structure_id",
    "station_id",
    "market_transaction_id",
    "character_id",
    "corporation_id",
    "alliance_id",
    "eve_system",
    "industry_job_id",
    "contract_id",
    "planet_id",
    "system_id",
    "type_id"
  ]).optional(),
  date: z.iso.datetime({ offset: true }),
  description: z.string(),
  first_party_id: z.int().optional(),
  id: z.int(),
  reason: z.string().optional(),
  ref_type: z.enum([
    "acceleration_gate_fee",
    "achievement_category_milestone_reward",
    "achievement_milestone_reward",
    "advertisement_listing_fee",
    "agent_donation",
    "agent_location_services",
    "agent_miscellaneous",
    "agent_mission_collateral_paid",
    "agent_mission_collateral_refunded",
    "agent_mission_reward",
    "agent_mission_reward_corporation_tax",
    "agent_mission_security_tax",
    "agent_mission_time_bonus_reward",
    "agent_mission_time_bonus_reward_corporation_tax",
    "agent_security_services",
    "agent_services_rendered",
    "agents_preward",
    "air_career_program_reward",
    "alliance_maintainance_fee",
    "alliance_registration_fee",
    "allignment_based_gate_toll",
    "asset_safety_recovery_tax",
    "bounty",
    "bounty_prize",
    "bounty_prize_corporation_tax",
    "bounty_prizes",
    "bounty_reimbursement",
    "bounty_surcharge",
    "brokers_fee",
    "campaign_objective_isk_reward",
    "clone_activation",
    "clone_transfer",
    "contraband_fine",
    "contract_auction_bid",
    "contract_auction_bid_corp",
    "contract_auction_bid_refund",
    "contract_auction_sold",
    "contract_brokers_fee",
    "contract_brokers_fee_corp",
    "contract_collateral",
    "contract_collateral_deposited_corp",
    "contract_collateral_payout",
    "contract_collateral_refund",
    "contract_deposit",
    "contract_deposit_corp",
    "contract_deposit_refund",
    "contract_deposit_sales_tax",
    "contract_price",
    "contract_price_payment_corp",
    "contract_reversal",
    "contract_reward",
    "contract_reward_deposited",
    "contract_reward_deposited_corp",
    "contract_reward_refund",
    "contract_sales_tax",
    "copying",
    "corporate_reward_payout",
    "corporate_reward_tax",
    "corporation_account_withdrawal",
    "corporation_bulk_payment",
    "corporation_dividend_payment",
    "corporation_liquidation",
    "corporation_logo_change_cost",
    "corporation_payment",
    "corporation_registration_fee",
    "cosmetic_market_component_item_purchase",
    "cosmetic_market_skin_purchase",
    "cosmetic_market_skin_sale",
    "cosmetic_market_skin_sale_broker_fee",
    "cosmetic_market_skin_sale_tax",
    "cosmetic_market_skin_transaction",
    "courier_mission_escrow",
    "cspa",
    "cspaofflinerefund",
    "daily_challenge_reward",
    "daily_goal_payouts",
    "daily_goal_payouts_tax",
    "datacore_fee",
    "dna_modification_fee",
    "docking_fee",
    "duel_wager_escrow",
    "duel_wager_payment",
    "duel_wager_refund",
    "ess_escrow_transfer",
    "external_trade_delivery",
    "external_trade_freeze",
    "external_trade_thaw",
    "factory_slot_rental_fee",
    "flux_payout",
    "flux_tax",
    "flux_ticket_repayment",
    "flux_ticket_sale",
    "freelance_jobs_broadcasting_fee",
    "freelance_jobs_duration_fee",
    "freelance_jobs_escrow_refund",
    "freelance_jobs_reward",
    "freelance_jobs_reward_corporation_tax",
    "freelance_jobs_reward_escrow",
    "gm_cash_transfer",
    "gm_plex_fee_refund",
    "industry_job_tax",
    "industry_security_tax",
    "infrastructure_hub_maintenance",
    "inheritance",
    "insurance",
    "insurgency_corruption_contribution_reward",
    "insurgency_suppression_contribution_reward",
    "item_trader_payment",
    "jump_clone_activation_fee",
    "jump_clone_installation_fee",
    "kill_right_fee",
    "lp_store",
    "manufacturing",
    "market_escrow",
    "market_fine_paid",
    "market_provider_tax",
    "market_security_tax",
    "market_transaction",
    "medal_creation",
    "medal_issued",
    "milestone_reward_payment",
    "mission_completion",
    "mission_cost",
    "mission_expiration",
    "mission_reward",
    "npc_bounty_security_tax",
    "office_rental_fee",
    "operation_bonus",
    "opportunity_reward",
    "planetary_construction",
    "planetary_export_tax",
    "planetary_import_tax",
    "player_donation",
    "player_trading",
    "project_discovery_reward",
    "project_discovery_tax",
    "project_payouts",
    "reaction",
    "redeemed_isk_token",
    "release_of_impounded_property",
    "repair_bill",
    "reprocessing_tax",
    "researching_material_productivity",
    "researching_technology",
    "researching_time_productivity",
    "resource_wars_reward",
    "reverse_engineering",
    "season_challenge_reward",
    "security_processing_fee",
    "shares",
    "skill_purchase",
    "skyhook_claim_fee",
    "sovereignity_bill",
    "store_purchase",
    "store_purchase_refund",
    "structure_gate_jump",
    "transaction_tax",
    "under_construction",
    "upkeep_adjustment_fee",
    "war_ally_contract",
    "war_fee",
    "war_fee_surrender"
  ]),
  second_party_id: z.int().optional(),
  tax: z.number().optional(),
  tax_receiver_id: z.int().optional()
}));
const zCorporationsCorporationIdWalletsDivisionTransactionsGet = z.array(z.looseObject({
  client_id: z.int(),
  date: z.iso.datetime({ offset: true }),
  is_buy: z.boolean(),
  journal_ref_id: z.int(),
  location_id: z.int(),
  quantity: z.int(),
  transaction_id: z.int(),
  type_id: z.int(),
  unit_price: z.number()
}));
const zCorporationsCorporationIdWalletsGet = z.array(z.looseObject({
  balance: z.number(),
  division: z.int()
}));
const zCorporationsDetailPalette = z.looseObject({
  main_color: z.string(),
  secondary_color: z.string().optional(),
  tertiary_color: z.string().optional()
});
const zCorporationsDetailTaxrates = z.looseObject({
  isk: z.number(),
  loyalty_point: z.number()
});
const zCorporationsFreelanceJobsParticipantsParticipant = z.looseObject({
  contributed: z.int(),
  id: zCharacterId,
  name: z.string(),
  state: z.enum([
    "Unspecified",
    "Committed",
    "Kicked",
    "Resigned"
  ])
});
const zCorporationsNpccorpsGet = z.array(z.int());
const zCorporationsProjectsContribution = z.looseObject({
  contributed: z.int(),
  last_modified: z.iso.datetime({ offset: true }).optional()
});
const zCorporationsProjectsContributorsContributor = z.looseObject({
  contributed: z.int(),
  id: zCharacterId,
  name: z.string()
});
const zCorporationsProjectsDetailConfigurationmanual = z.looseObject({}).catchall(z.unknown());
const zCorporationsProjectsDetailConfigurationmatcherarchetype = z.looseObject({
  archetype_id: zArchetypeId.optional()
});
const zCorporationsProjectsDetailConfigurationmatchercorporation = z.looseObject({
  corporation_id: zCorporationId.optional()
});
const zCorporationsProjectsDetailConfigurationearnloyaltypoints = z.looseObject({
  corporations: z.array(zCorporationsProjectsDetailConfigurationmatchercorporation).optional()
});
const zCorporationsProjectsDetailConfigurationmatchersignature = z.looseObject({
  signature_type_id: zAttributeId.optional()
});
const zCorporationsProjectsDetailConfigurationunknown = z.looseObject({
  data: z.unknown(),
  type: z.string()
});
const zCorporationsProjectsDetailContribution = z.looseObject({
  participation_limit: z.int().optional(),
  reward_per_contribution: z.number().optional(),
  submission_limit: z.int().optional(),
  submission_multiplier: z.number().optional()
});
const zCorporationsProjectsDetailCreator = z.looseObject({
  id: zCharacterId,
  name: z.string()
});
const zCorporationsProjectsDetailDetails = z.looseObject({
  career: z.enum([
    "Unspecified",
    "Explorer",
    "Industrialist",
    "Enforcer",
    "Soldier of Fortune"
  ]),
  created: z.iso.datetime({ offset: true }),
  description: z.string(),
  expires: z.iso.datetime({ offset: true }).optional(),
  finished: z.iso.datetime({ offset: true }).optional()
});
const zCorporationsProjectsDetailProgress = z.looseObject({
  current: z.int(),
  desired: z.int()
});
const zCorporationsProjectsDetailReward = z.looseObject({
  initial: z.number(),
  remaining: z.number()
});
const zCorporationsStructuresSkyhooksDetailReinforcementtimer = z.looseObject({
  end: z.iso.datetime({ offset: true })
});
const zCorporationsStructuresSkyhooksDetailTheftvulnerability = z.looseObject({
  end: z.iso.datetime({ offset: true }),
  start: z.iso.datetime({ offset: true })
});
const zCorporationsStructuresSovereigntyHubsDetailResourcepower = z.looseObject({
  allocated: z.int(),
  available: z.int()
});
const zCorporationsStructuresSovereigntyHubsDetailResourceworkforce = z.looseObject({
  allocated: z.int(),
  available: z.int()
});
const zCorporationsStructuresSovereigntyHubsDetailResources = z.looseObject({
  power: zCorporationsStructuresSovereigntyHubsDetailResourcepower,
  workforce: zCorporationsStructuresSovereigntyHubsDetailResourceworkforce
});
const zCorporationsStructuresSovereigntyHubsDetailVulnerabilitywindow = z.looseObject({
  end: z.iso.datetime({ offset: true }),
  start: z.iso.datetime({ offset: true })
});
const zCosmeticsSkinrPatternprojection = z.looseObject({
  slot1: z.boolean(),
  slot2: z.boolean(),
  slot3: z.boolean(),
  slot4: z.boolean()
});
const zCosmeticsSkinrSlotnanocoating = z.looseObject({
  id: z.int()
});
const zCosmeticsSkinrTier = z.looseObject({
  level: z.int()
});
const zCosmeticsSkinrVector3 = z.looseObject({
  x: z.number(),
  y: z.number(),
  z: z.number()
});
const zCosmeticsSkinrVector4 = z.looseObject({
  w: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number()
});
const zCosmeticsSkinrPatterntransform = z.looseObject({
  position: zCosmeticsSkinrVector3,
  rotation: zCosmeticsSkinrVector4,
  scaling: zCosmeticsSkinrVector3
});
const zCosmeticsSkinrPatternconfiguration = z.looseObject({
  mirrored: z.boolean(),
  projection: zCosmeticsSkinrPatternprojection,
  transform: zCosmeticsSkinrPatterntransform
});
const zCosmeticsSkinrSlotpattern = z.looseObject({
  configuration: zCosmeticsSkinrPatternconfiguration,
  id: z.int()
});
const zCosmeticsSkinrLayoutslot = z.looseObject({
  configuration: z.xor([
    z.looseObject({
      nanocoating: zCosmeticsSkinrSlotnanocoating.optional()
    }),
    z.looseObject({
      pattern: zCosmeticsSkinrSlotpattern.optional()
    })
  ]),
  id: z.int()
});
const zCosmeticsSkinrLayout = z.looseObject({
  pattern_blend_mode: z.enum([
    "normal",
    "subtract",
    "exclusion",
    "nested",
    "nested_inverted"
  ]),
  slots: z.array(zCosmeticsSkinrLayoutslot)
});
const zCursor = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional()
});
const zCorporationsFreelanceJobsParticipants = z.looseObject({
  cursor: zCursor.optional(),
  participants: z.array(zCorporationsFreelanceJobsParticipantsParticipant)
});
const zCorporationsProjectsContributors = z.looseObject({
  contributors: z.array(zCorporationsProjectsContributorsContributor),
  cursor: zCursor.optional()
});
const zDogmaAttributesAttributeIdGet = z.looseObject({
  attribute_id: z.int(),
  default_value: z.number().optional(),
  description: z.string().optional(),
  display_name: z.string().optional(),
  high_is_good: z.boolean().optional(),
  icon_id: z.int().optional(),
  name: z.string().optional(),
  published: z.boolean().optional(),
  stackable: z.boolean().optional(),
  unit_id: z.int().optional()
});
const zDogmaAttributesGet = z.array(z.int());
const zDogmaDynamicItemsTypeIdItemIdGet = z.looseObject({
  created_by: z.int(),
  dogma_attributes: z.array(z.looseObject({
    attribute_id: z.int(),
    value: z.number()
  })),
  dogma_effects: z.array(z.looseObject({
    effect_id: z.int(),
    is_default: z.boolean()
  })),
  mutator_type_id: z.int(),
  source_type_id: z.int()
});
const zDogmaEffectsEffectIdGet = z.looseObject({
  description: z.string().optional(),
  disallow_auto_repeat: z.boolean().optional(),
  discharge_attribute_id: z.int().optional(),
  display_name: z.string().optional(),
  duration_attribute_id: z.int().optional(),
  effect_category: z.int().optional(),
  effect_id: z.int(),
  electronic_chance: z.boolean().optional(),
  falloff_attribute_id: z.int().optional(),
  icon_id: z.int().optional(),
  is_assistance: z.boolean().optional(),
  is_offensive: z.boolean().optional(),
  is_warp_safe: z.boolean().optional(),
  modifiers: z.array(z.looseObject({
    domain: z.string().optional(),
    effect_id: z.int().optional(),
    func: z.string(),
    modified_attribute_id: z.int().optional(),
    modifying_attribute_id: z.int().optional(),
    operator: z.int().optional()
  })).optional(),
  name: z.string().optional(),
  post_expression: z.int().optional(),
  pre_expression: z.int().optional(),
  published: z.boolean().optional(),
  range_attribute_id: z.int().optional(),
  range_chance: z.boolean().optional(),
  tracking_speed_attribute_id: z.int().optional()
});
const zDogmaEffectsGet = z.array(z.int());
const zDungeonId = z.int();
const zErrorDetail = z.looseObject({
  location: z.string().optional(),
  message: z.string().optional(),
  value: z.unknown().optional()
});
const zError = z.looseObject({
  details: z.array(zErrorDetail).optional(),
  error: z.string(),
  status: z.int().optional()
});
const zFactionId = z.int();
const zAllianceDetail = z.looseObject({
  creator_corporation_id: zCorporationId,
  creator_id: zCharacterId,
  date_founded: z.iso.datetime({ offset: true }),
  executor_corporation_id: zCorporationId.optional(),
  faction_id: zFactionId.optional(),
  name: z.string(),
  ticker: z.string()
});
const zCorporationsProjectsDetailConfigurationmatcherfaction = z.looseObject({
  faction_id: zFactionId.optional()
});
const zFleetsFleetIdGet = z.looseObject({
  is_free_move: z.boolean(),
  is_registered: z.boolean(),
  is_voice_enabled: z.boolean(),
  motd: z.string()
});
const zFleetsFleetIdMembersGet = z.array(z.looseObject({
  character_id: z.int(),
  join_time: z.iso.datetime({ offset: true }),
  role: z.enum([
    "fleet_commander",
    "wing_commander",
    "squad_commander",
    "squad_member"
  ]),
  role_name: z.string(),
  ship_type_id: z.int(),
  solar_system_id: z.int(),
  squad_id: z.int(),
  station_id: z.int().optional(),
  takes_fleet_warp: z.boolean(),
  wing_id: z.int()
}));
const zFleetsFleetIdWingsGet = z.array(z.looseObject({
  id: z.int(),
  name: z.string(),
  squads: z.array(z.looseObject({
    id: z.int(),
    name: z.string()
  }))
}));
const zFleetsFleetIdWingsPost = z.looseObject({
  wing_id: z.int()
});
const zFleetsFleetIdWingsWingIdSquadsPost = z.looseObject({
  squad_id: z.int()
});
const zFreelanceJobsDetailContribution = z.looseObject({
  contribution_per_participant_limit: z.int().optional(),
  max_committed_participants: z.int(),
  reward_per_contribution: z.number().optional(),
  submission_limit: z.int().optional(),
  submission_multiplier: z.number().optional()
});
const zFreelanceJobsDetailCreatorcharacter = z.looseObject({
  id: zCharacterId,
  name: z.string()
});
const zFreelanceJobsDetailCreatorcorporation = z.looseObject({
  id: zCorporationId,
  name: z.string()
});
const zFreelanceJobsDetailCreator = z.looseObject({
  character: zFreelanceJobsDetailCreatorcharacter,
  corporation: zFreelanceJobsDetailCreatorcorporation
});
const zFreelanceJobsDetailDetails = z.looseObject({
  career: z.enum([
    "Unspecified",
    "Explorer",
    "Industrialist",
    "Enforcer",
    "Soldier of Fortune"
  ]),
  created: z.iso.datetime({ offset: true }),
  creator: zFreelanceJobsDetailCreator,
  description: z.string(),
  expires: z.iso.datetime({ offset: true }).optional(),
  finished: z.iso.datetime({ offset: true }).optional()
});
const zFreelanceJobsDetailParameterboolean = z.looseObject({
  value: z.boolean()
});
const zFreelanceJobsDetailParametermatchervalue = z.looseObject({
  value_type: z.string(),
  values: z.array(z.string())
});
const zFreelanceJobsDetailParametermatcher = z.looseObject({
  values: z.array(zFreelanceJobsDetailParametermatchervalue)
});
const zFreelanceJobsDetailParametercorporationitemdelivery = z.looseObject({
  corporation_office_location: zFreelanceJobsDetailParametermatcher,
  item_type: zFreelanceJobsDetailParametermatcher
});
const zFreelanceJobsDetailParameteroptions = z.looseObject({
  selected: z.array(z.string())
});
const zFreelanceJobsDetailConfiguration = z.looseObject({
  method: z.string(),
  parameters: z.looseObject({}).catchall(z.xor([
    z.looseObject({
      matcher: zFreelanceJobsDetailParametermatcher.optional()
    }),
    z.looseObject({
      options: zFreelanceJobsDetailParameteroptions.optional()
    }),
    z.looseObject({
      boolean: zFreelanceJobsDetailParameterboolean.optional()
    }),
    z.looseObject({
      corporation_item_delivery: zFreelanceJobsDetailParametercorporationitemdelivery.optional()
    })
  ])),
  version: z.int()
});
const zFreelanceJobsDetailProgress = z.looseObject({
  current: z.int(),
  desired: z.int()
});
const zFreelanceJobsDetailRestrictions = z.looseObject({
  maximum_age: z.int().optional(),
  minimum_age: z.int().optional()
});
const zFreelanceJobsDetailReward = z.looseObject({
  initial: z.number(),
  remaining: z.number()
});
const zFwLeaderboardsCharactersGet = z.looseObject({
  kills: z.looseObject({
    active_total: z.array(z.looseObject({
      amount: z.int().optional(),
      character_id: z.int().optional()
    })),
    last_week: z.array(z.looseObject({
      amount: z.int().optional(),
      character_id: z.int().optional()
    })),
    yesterday: z.array(z.looseObject({
      amount: z.int().optional(),
      character_id: z.int().optional()
    }))
  }),
  victory_points: z.looseObject({
    active_total: z.array(z.looseObject({
      amount: z.int().optional(),
      character_id: z.int().optional()
    })),
    last_week: z.array(z.looseObject({
      amount: z.int().optional(),
      character_id: z.int().optional()
    })),
    yesterday: z.array(z.looseObject({
      amount: z.int().optional(),
      character_id: z.int().optional()
    }))
  })
});
const zFwLeaderboardsCorporationsGet = z.looseObject({
  kills: z.looseObject({
    active_total: z.array(z.looseObject({
      amount: z.int().optional(),
      corporation_id: z.int().optional()
    })),
    last_week: z.array(z.looseObject({
      amount: z.int().optional(),
      corporation_id: z.int().optional()
    })),
    yesterday: z.array(z.looseObject({
      amount: z.int().optional(),
      corporation_id: z.int().optional()
    }))
  }),
  victory_points: z.looseObject({
    active_total: z.array(z.looseObject({
      amount: z.int().optional(),
      corporation_id: z.int().optional()
    })),
    last_week: z.array(z.looseObject({
      amount: z.int().optional(),
      corporation_id: z.int().optional()
    })),
    yesterday: z.array(z.looseObject({
      amount: z.int().optional(),
      corporation_id: z.int().optional()
    }))
  })
});
const zFwLeaderboardsGet = z.looseObject({
  kills: z.looseObject({
    active_total: z.array(z.looseObject({
      amount: z.int().optional(),
      faction_id: z.int().optional()
    })),
    last_week: z.array(z.looseObject({
      amount: z.int().optional(),
      faction_id: z.int().optional()
    })),
    yesterday: z.array(z.looseObject({
      amount: z.int().optional(),
      faction_id: z.int().optional()
    }))
  }),
  victory_points: z.looseObject({
    active_total: z.array(z.looseObject({
      amount: z.int().optional(),
      faction_id: z.int().optional()
    })),
    last_week: z.array(z.looseObject({
      amount: z.int().optional(),
      faction_id: z.int().optional()
    })),
    yesterday: z.array(z.looseObject({
      amount: z.int().optional(),
      faction_id: z.int().optional()
    }))
  })
});
const zFwStatsGet = z.array(z.looseObject({
  faction_id: z.int(),
  kills: z.looseObject({
    last_week: z.int(),
    total: z.int(),
    yesterday: z.int()
  }),
  pilots: z.int(),
  systems_controlled: z.int(),
  victory_points: z.looseObject({
    last_week: z.int(),
    total: z.int(),
    yesterday: z.int()
  })
}));
const zFwSystemsGet = z.array(z.looseObject({
  contested: z.enum([
    "captured",
    "contested",
    "uncontested",
    "vulnerable"
  ]),
  occupier_faction_id: z.int(),
  owner_faction_id: z.int(),
  solar_system_id: z.int(),
  victory_points: z.int(),
  victory_points_threshold: z.int()
}));
const zFwWarsGet = z.array(z.looseObject({
  against_id: z.int(),
  faction_id: z.int()
}));
const zGroupId = z.int();
const zIncursionsGet = z.array(z.looseObject({
  constellation_id: z.int(),
  faction_id: z.int(),
  has_boss: z.boolean(),
  infested_solar_systems: z.array(z.int()),
  influence: z.number(),
  staging_solar_system_id: z.int(),
  state: z.enum([
    "withdrawing",
    "mobilizing",
    "established"
  ]),
  type: z.string()
}));
const zIndustryFacilitiesGet = z.array(z.looseObject({
  facility_id: z.int(),
  owner_id: z.int(),
  region_id: z.int(),
  solar_system_id: z.int(),
  tax: z.number().optional(),
  type_id: z.int()
}));
const zIndustrySystemsGet = z.array(z.looseObject({
  cost_indices: z.array(z.looseObject({
    activity: z.enum([
      "copying",
      "duplicating",
      "invention",
      "manufacturing",
      "none",
      "reaction",
      "researching_material_efficiency",
      "researching_technology",
      "researching_time_efficiency",
      "reverse_engineering"
    ]),
    cost_index: z.number()
  })),
  solar_system_id: z.int()
}));
const zInsurancePricesGet = z.array(z.looseObject({
  levels: z.array(z.looseObject({
    cost: z.number(),
    name: z.string(),
    payout: z.number()
  })),
  type_id: z.int()
}));
const zItemId = z.int();
const zKillmailsKillmailIdKillmailHashGet = z.looseObject({
  attackers: z.array(z.looseObject({
    alliance_id: z.int().optional(),
    character_id: z.int().optional(),
    corporation_id: z.int().optional(),
    damage_done: z.int(),
    faction_id: z.int().optional(),
    final_blow: z.boolean(),
    security_status: z.number(),
    ship_type_id: z.int().optional(),
    weapon_type_id: z.int().optional()
  })),
  killmail_id: z.int(),
  killmail_time: z.iso.datetime({ offset: true }),
  moon_id: z.int().optional(),
  solar_system_id: z.int(),
  victim: z.looseObject({
    alliance_id: z.int().optional(),
    character_id: z.int().optional(),
    corporation_id: z.int().optional(),
    damage_taken: z.int(),
    faction_id: z.int().optional(),
    items: z.array(z.looseObject({
      flag: z.int(),
      item_type_id: z.int(),
      items: z.array(z.looseObject({
        flag: z.int(),
        item_type_id: z.int(),
        quantity_destroyed: z.int().optional(),
        quantity_dropped: z.int().optional(),
        singleton: z.int()
      })).optional(),
      quantity_destroyed: z.int().optional(),
      quantity_dropped: z.int().optional(),
      singleton: z.int()
    })).optional(),
    position: z.looseObject({
      x: z.number(),
      y: z.number(),
      z: z.number()
    }).optional(),
    ship_type_id: z.int()
  }),
  war_id: z.int().optional()
});
const zLoyaltyStoresCorporationIdOffersGet = z.array(z.looseObject({
  ak_cost: z.int().optional(),
  isk_cost: z.int(),
  lp_cost: z.int(),
  offer_id: z.int(),
  quantity: z.int(),
  required_items: z.array(z.looseObject({
    quantity: z.int(),
    type_id: z.int()
  })),
  type_id: z.int()
}));
const zMarketsGroupsGet = z.array(z.int());
const zMarketsGroupsMarketGroupIdGet = z.looseObject({
  description: z.string(),
  market_group_id: z.int(),
  name: z.string(),
  parent_group_id: z.int().optional(),
  types: z.array(z.int())
});
const zMarketsPricesGet = z.array(z.looseObject({
  adjusted_price: z.number().optional(),
  average_price: z.number().optional(),
  type_id: z.int()
}));
const zMarketsRegionIdHistoryGet = z.array(z.looseObject({
  average: z.number(),
  date: z.iso.date(),
  highest: z.number(),
  lowest: z.number(),
  order_count: z.int(),
  volume: z.int()
}));
const zMarketsRegionIdOrdersGet = z.array(z.looseObject({
  duration: z.int(),
  is_buy_order: z.boolean(),
  issued: z.iso.datetime({ offset: true }),
  location_id: z.int(),
  min_volume: z.int(),
  order_id: z.int(),
  price: z.number(),
  range: z.enum([
    "station",
    "region",
    "solarsystem",
    "1",
    "2",
    "3",
    "4",
    "5",
    "10",
    "20",
    "30",
    "40"
  ]),
  system_id: z.int(),
  type_id: z.int(),
  volume_remain: z.int(),
  volume_total: z.int()
}));
const zMarketsRegionIdTypesGet = z.array(z.int());
const zMarketsStructuresStructureIdGet = z.array(z.looseObject({
  duration: z.int(),
  is_buy_order: z.boolean(),
  issued: z.iso.datetime({ offset: true }),
  location_id: z.int(),
  min_volume: z.int(),
  order_id: z.int(),
  price: z.number(),
  range: z.enum([
    "station",
    "region",
    "solarsystem",
    "1",
    "2",
    "3",
    "4",
    "5",
    "10",
    "20",
    "30",
    "40"
  ]),
  type_id: z.int(),
  volume_remain: z.int(),
  volume_total: z.int()
}));
const zMetaChangelogEntry = z.looseObject({
  compatibility_date: zCompatibilityDate,
  description: z.string(),
  method: z.enum([
    "GET",
    "POST",
    "PUT",
    "DELETE"
  ]),
  path: z.string(),
  type: z.enum([
    "breaking",
    "changed",
    "new",
    "removed"
  ])
});
const zMetaChangelog = z.looseObject({
  changelog: z.looseObject({}).catchall(z.array(zMetaChangelogEntry))
});
const zMetaCompatibilityDates = z.looseObject({
  compatibility_dates: z.array(zCompatibilityDate)
});
const zMetaNameEntry = z.looseObject({
  date: z.string(),
  name: z.string()
});
const zMetaName = z.looseObject({
  current: z.string(),
  history: z.array(zMetaNameEntry)
});
const zMetaStatusRoutestatus = z.looseObject({
  method: z.enum([
    "GET",
    "POST",
    "PUT",
    "DELETE"
  ]),
  path: z.string(),
  status: z.enum([
    "Unknown",
    "OK",
    "Degraded",
    "Down",
    "Recovering"
  ])
});
const zMetaStatus = z.looseObject({
  routes: z.array(zMetaStatusRoutestatus)
});
const zMilitaryCampaignsObjectivesDetailParticipants = z.looseObject({
  committed: z.int(),
  contributors: z.int(),
  total: z.int()
});
const zPlanetId = z.int();
const zCharactersStructuresMercenaryDensDetailSkyhook = z.looseObject({
  corporation_id: zCorporationId,
  id: zItemId,
  planet_id: zPlanetId
});
const zCharactersStructuresMercenaryDensListingMercenaryden = z.looseObject({
  id: zItemId,
  planet_id: zPlanetId
});
const zCharactersStructuresMercenaryDensListing = z.looseObject({
  mercenary_dens: z.array(zCharactersStructuresMercenaryDensListingMercenaryden)
});
const zCorporationsStructuresSkyhooksListingSkyhook = z.looseObject({
  id: zItemId,
  planet_id: zPlanetId
});
const zCorporationsStructuresSkyhooksListing = z.looseObject({
  skyhooks: z.array(zCorporationsStructuresSkyhooksListingSkyhook)
});
const zRaceId = z.int();
const zRegionId = z.int();
const zShipTreeGroupId = z.int();
const zSkyhooksRaidableTheftvulnerability = z.looseObject({
  end: z.iso.datetime({ offset: true }),
  start: z.iso.datetime({ offset: true })
});
const zSolarSystemId = z.int();
const zCorporationsProjectsDetailConfigurationcapturefwcomplex = z.looseObject({
  archetypes: z.array(zCorporationsProjectsDetailConfigurationmatcherarchetype).optional(),
  factions: z.array(zCorporationsProjectsDetailConfigurationmatcherfaction).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional()
});
const zCorporationsProjectsDetailConfigurationdefendfwcomplex = z.looseObject({
  archetypes: z.array(zCorporationsProjectsDetailConfigurationmatcherarchetype).optional(),
  factions: z.array(zCorporationsProjectsDetailConfigurationmatcherfaction).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional()
});
const zCorporationsProjectsDetailConfigurationdestroynpc = z.looseObject({
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional()
});
const zCorporationsProjectsDetailConfigurationsalvagewreck = z.looseObject({
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional()
});
const zCorporationsProjectsDetailConfigurationscansignature = z.looseObject({
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  signatures: z.array(zCorporationsProjectsDetailConfigurationmatchersignature).optional()
});
const zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationexport = z.looseObject({
  amount: z.int(),
  solar_system_id: zSolarSystemId.optional()
});
const zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationsource = z.looseObject({
  solar_system_id: zSolarSystemId
});
const zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationimport = z.looseObject({
  sources: z.array(zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationsource)
});
const zCorporationsStructuresSovereigntyHubsDetailTransportstateexport = z.looseObject({
  amount: z.int().optional(),
  solar_system_id: zSolarSystemId.optional()
});
const zCorporationsStructuresSovereigntyHubsDetailTransportstateimportsource = z.looseObject({
  amount: z.int(),
  solar_system_id: zSolarSystemId
});
const zCorporationsStructuresSovereigntyHubsDetailTransportstateimport = z.looseObject({
  sources: z.array(zCorporationsStructuresSovereigntyHubsDetailTransportstateimportsource)
});
const zCorporationsStructuresSovereigntyHubsDetailTransport = z.looseObject({
  configuration: z.xor([
    z.looseObject({
      import: zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationimport.optional()
    }),
    z.looseObject({
      export: zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationexport.optional()
    }),
    z.looseObject({
      transit: z.boolean().nullish()
    })
  ]),
  state: z.xor([
    z.looseObject({
      import: zCorporationsStructuresSovereigntyHubsDetailTransportstateimport.optional()
    }),
    z.looseObject({
      export: zCorporationsStructuresSovereigntyHubsDetailTransportstateexport.optional()
    }),
    z.looseObject({
      transit: z.boolean().nullish()
    })
  ])
});
const zCorporationsStructuresSovereigntyHubsListingSovereigntyhub = z.looseObject({
  id: zItemId,
  solar_system_id: zSolarSystemId
});
const zCorporationsStructuresSovereigntyHubsListing = z.looseObject({
  sovereignty_hubs: z.array(zCorporationsStructuresSovereigntyHubsListingSovereigntyhub)
});
const zFreelanceJobsDetailBroadcastlocations = z.looseObject({
  id: zSolarSystemId,
  name: z.string()
});
const zFreelanceJobsDetailAccessandvisibility = z.looseObject({
  acl_protected: z.boolean(),
  broadcast_locations: z.array(zFreelanceJobsDetailBroadcastlocations).optional(),
  restrictions: zFreelanceJobsDetailRestrictions.optional()
});
const zRoute = z.looseObject({
  route: z.array(zSolarSystemId)
});
const zRouteConnection = z.looseObject({
  from: zSolarSystemId,
  to: zSolarSystemId
});
const zRouteRequestBody = z.looseObject({
  avoid_systems: z.array(zSolarSystemId).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  connections: z.array(zRouteConnection).max(1e3).optional(),
  preference: z.enum([
    "Shorter",
    "Safer",
    "LessSecure"
  ]).optional().default("Shorter"),
  security_penalty: z.int().gte(0).lte(100).optional().default(50)
});
const zSkyhooksRaidableVulnerableskyhook = z.looseObject({
  planet_id: zPlanetId,
  solar_system_id: zSolarSystemId,
  theft_vulnerability: zSkyhooksRaidableTheftvulnerability
});
const zSkyhooksRaidable = z.looseObject({
  skyhooks: z.array(zSkyhooksRaidableVulnerableskyhook)
});
const zSovereigntyCampaignsGet = z.array(z.looseObject({
  attackers_score: z.number().optional(),
  campaign_id: z.int(),
  constellation_id: z.int(),
  defender_id: z.int().optional(),
  defender_score: z.number().optional(),
  event_type: z.enum([
    "tcu_defense",
    "ihub_defense",
    "station_defense",
    "station_freeport"
  ]),
  participants: z.array(z.looseObject({
    alliance_id: z.int(),
    score: z.number()
  })).optional(),
  solar_system_id: z.int(),
  start_time: z.iso.datetime({ offset: true }),
  structure_id: z.int()
}));
const zSovereigntySystemsDevelopment = z.looseObject({
  activity_defense_multiplier: z.number(),
  industrial_level: z.int(),
  military_level: z.int(),
  strategic_level: z.int()
});
const zSovereigntySystemsFaction = z.looseObject({
  faction_id: zFactionId
});
const zSovereigntySystemsVulnerabilitywindow = z.looseObject({
  end: z.iso.datetime({ offset: true }),
  start: z.iso.datetime({ offset: true })
});
const zSovereigntySystemsSovereigntyhub = z.looseObject({
  id: zItemId,
  vulnerability_window: zSovereigntySystemsVulnerabilitywindow.optional()
});
const zSovereigntySystemsAlliance = z.looseObject({
  alliance_id: zAllianceId,
  claimed_since: z.iso.datetime({ offset: true }),
  corporation_id: zCorporationId,
  development: zSovereigntySystemsDevelopment,
  is_capital_system: z.boolean(),
  sovereignty_hub: zSovereigntySystemsSovereigntyhub
});
const zSovereigntySystemsSolarsystem = z.looseObject({
  claim: z.xor([
    z.looseObject({
      faction: zSovereigntySystemsFaction.optional()
    }),
    z.looseObject({
      alliance: zSovereigntySystemsAlliance.optional()
    }),
    z.looseObject({
      unclaimed: z.boolean().optional()
    })
  ]),
  solar_system_id: zSolarSystemId
});
const zSovereigntySystems = z.looseObject({
  solar_systems: z.array(zSovereigntySystemsSolarsystem)
});
const zStationId = z.int();
const zCorporationsDetail = z.looseObject({
  alliance_id: zAllianceId.optional(),
  ceo_id: zCharacterId.optional(),
  creator_id: zCharacterId.optional(),
  date_founded: z.iso.datetime({ offset: true }).optional(),
  description: z.string(),
  enlisted_faction_id: zFactionId.optional(),
  friendly_fire: z.enum(["legal", "illegal"]),
  home_station_id: zStationId,
  member_count: z.int(),
  name: z.string(),
  palette: zCorporationsDetailPalette.optional(),
  shares: z.int(),
  state: z.enum(["active", "closed"]),
  tax_rates: zCorporationsDetailTaxrates,
  ticker: z.string(),
  type: z.enum(["player_owned", "npc_owned"]),
  url: z.string().optional(),
  war_eligible: z.boolean()
});
const zStatus = z.looseObject({
  players: z.int(),
  server_version: z.string(),
  start_time: z.iso.datetime({ offset: true }),
  vip: z.boolean()
});
const zTypeId = z.int();
const zCharactersSkillqueueSkill = z.looseObject({
  finish_date: z.iso.datetime({ offset: true }).optional(),
  finished_level: z.int(),
  level_end_sp: z.int().optional(),
  level_start_sp: z.int().optional(),
  queue_position: z.int(),
  skill_id: zTypeId,
  start_date: z.iso.datetime({ offset: true }).optional(),
  training_start_sp: z.int().optional()
});
const zCharactersStructuresMercenaryDensDetail = z.looseObject({
  evolution: zCharactersStructuresMercenaryDensDetailEvolution,
  id: zItemId,
  infomorphs: zCharactersStructuresMercenaryDensDetailInfomorphs,
  reinforcement_timer: zCharactersStructuresMercenaryDensDetailReinforcementtimer.optional(),
  skyhook: zCharactersStructuresMercenaryDensDetailSkyhook,
  state: z.enum([
    "Unspecified",
    "Running",
    "Paused",
    "Disabled"
  ]),
  type_id: zTypeId
});
const zCorporationsProjectsDetailConfigurationdamageship = z.looseObject({
  identities: z.array(z.union([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      faction_id: zFactionId.optional()
    })
  ])).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  ships: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zShipTreeGroupId.optional()
  })])).optional()
});
const zCorporationsProjectsDetailConfigurationdeliveritem = z.looseObject({
  docking_locations: z.array(z.union([z.looseObject({
    structure_id: zItemId.optional()
  }), z.looseObject({
    station_id: zStationId.optional()
  })])).optional(),
  items: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zGroupId.optional()
  })])).optional(),
  office_id: zItemId.optional()
});
const zCorporationsProjectsDetailConfigurationdestroyship = z.looseObject({
  identities: z.array(z.union([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      faction_id: zFactionId.optional()
    })
  ])).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  ships: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zShipTreeGroupId.optional()
  })])).optional()
});
const zCorporationsProjectsDetailConfigurationlostship = z.looseObject({
  identities: z.array(z.union([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      faction_id: zFactionId.optional()
    })
  ])).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  ships: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zShipTreeGroupId.optional()
  })])).optional()
});
const zCorporationsProjectsDetailConfigurationmanufactureitem = z.looseObject({
  docking_locations: z.array(z.union([z.looseObject({
    structure_id: zItemId.optional()
  }), z.looseObject({
    station_id: zStationId.optional()
  })])).optional(),
  items: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zGroupId.optional()
  })])).optional(),
  owner: z.enum([
    "Any",
    "Corporation",
    "Character"
  ])
});
const zCorporationsProjectsDetailConfigurationminematerial = z.looseObject({
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  materials: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zGroupId.optional()
  })])).optional()
});
const zCorporationsProjectsDetailConfigurationremoteboostshield = z.looseObject({
  identities: z.array(z.union([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      faction_id: zFactionId.optional()
    })
  ])).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  ships: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zShipTreeGroupId.optional()
  })])).optional()
});
const zCorporationsProjectsDetailConfigurationremoterepairarmor = z.looseObject({
  identities: z.array(z.union([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      faction_id: zFactionId.optional()
    })
  ])).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  ships: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zShipTreeGroupId.optional()
  })])).optional()
});
const zCorporationsProjectsDetailConfigurationshipinsurance = z.looseObject({
  conflict_type: z.enum([
    "Any",
    "Pvp",
    "Pve"
  ]),
  identities: z.array(z.union([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      faction_id: zFactionId.optional()
    })
  ])).optional(),
  locations: z.array(z.union([
    z.looseObject({
      solar_system_id: zSolarSystemId.optional()
    }),
    z.looseObject({
      constellation_id: zConstellationId.optional()
    }),
    z.looseObject({
      region_id: zRegionId.optional()
    })
  ])).optional(),
  reimburse_implants: z.boolean(),
  ships: z.array(z.union([z.looseObject({
    type_id: zTypeId.optional()
  }), z.looseObject({
    group_id: zShipTreeGroupId.optional()
  })])).optional()
});
const zCorporationsStructuresSkyhooksDetailReagent = z.looseObject({
  last_cycle: z.iso.datetime({ offset: true }),
  secured_stock: z.int(),
  type_id: zTypeId,
  unsecured_stock: z.int()
});
const zCorporationsStructuresSkyhooksDetail = z.looseObject({
  effective_workforce: z.int().optional(),
  id: zItemId,
  is_active: z.boolean(),
  planet_id: zPlanetId,
  reagents: z.array(zCorporationsStructuresSkyhooksDetailReagent).optional(),
  reinforcement_timer: zCorporationsStructuresSkyhooksDetailReinforcementtimer.optional(),
  state: z.enum([
    "Unspecified",
    "ShieldVulnerable",
    "ArmorReinforced",
    "ArmorVulnerable",
    "HullReinforced",
    "HullVulnerable"
  ]),
  theft_vulnerability: zCorporationsStructuresSkyhooksDetailTheftvulnerability.optional()
});
const zCorporationsStructuresSovereigntyHubsDetailReagent = z.looseObject({
  amount: z.int(),
  burning_per_hour: z.int(),
  type_id: zTypeId
});
const zCorporationsStructuresSovereigntyHubsDetailReagentbay = z.looseObject({
  last_updated: z.iso.datetime({ offset: true }),
  reagents: z.array(zCorporationsStructuresSovereigntyHubsDetailReagent)
});
const zCorporationsStructuresSovereigntyHubsDetailUpgrade = z.looseObject({
  power_state: z.enum([
    "Unspecified",
    "Online",
    "Offline",
    "Low",
    "Pending"
  ]),
  type_id: zTypeId
});
const zCorporationsStructuresSovereigntyHubsDetail = z.looseObject({
  fuel_access_list_id: zAccessListId.optional(),
  id: zItemId,
  reagent_bay: zCorporationsStructuresSovereigntyHubsDetailReagentbay,
  resources: zCorporationsStructuresSovereigntyHubsDetailResources,
  solar_system_id: zSolarSystemId,
  upgrades: z.array(zCorporationsStructuresSovereigntyHubsDetailUpgrade),
  vulnerability_window: zCorporationsStructuresSovereigntyHubsDetailVulnerabilitywindow.optional(),
  workforce_transport: zCorporationsStructuresSovereigntyHubsDetailTransport
});
const zCosmeticsSkinr = z.looseObject({
  creator_id: zCharacterId,
  id: z.string(),
  layout: zCosmeticsSkinrLayout,
  line: z.string().optional(),
  name: z.string(),
  ship_type_id: zTypeId,
  tier: zCosmeticsSkinrTier
});
const zUuid = z.uuid();
const zCharactersDetail = z.looseObject({
  achievement_score: z.int(),
  alliance_id: zAllianceId.optional(),
  birthday: z.iso.datetime({ offset: true }),
  bloodline_id: zBloodlineId,
  character_title_id: zUuid.optional(),
  corporation_id: zCorporationId,
  corporation_title: z.string().optional(),
  description: z.string().optional(),
  faction_id: zFactionId.optional(),
  gender: z.enum(["male", "female"]),
  name: z.string(),
  race_id: zRaceId,
  security_status: z.number().optional()
});
const zCharactersMercenaryTacticalOperationsDetail = z.looseObject({
  dungeon_type_id: zDungeonId,
  expires: z.iso.datetime({ offset: true }),
  id: zUuid,
  mercenary_den_id: zItemId,
  state: z.enum([
    "Unspecified",
    "Available",
    "Started",
    "Completed",
    "Expired",
    "Removed"
  ])
});
const zCharactersMercenaryTacticalOperationsListingOperation = z.looseObject({
  id: zUuid,
  mercenary_den_id: zItemId
});
const zCharactersMercenaryTacticalOperationsListing = z.looseObject({
  operations: z.array(zCharactersMercenaryTacticalOperationsListingOperation)
});
const zCharactersMilitaryCampaignsObjectivesParticipation = z.looseObject({
  campaign_id: zUuid,
  contributed: z.int(),
  id: zUuid,
  is_committed: z.boolean(),
  last_modified: z.iso.datetime({ offset: true })
});
const zCharactersMilitaryCampaignsObjectivesParticipationCharacterobjective = z.looseObject({
  campaign_id: zUuid,
  contributed: z.int(),
  id: zUuid,
  is_committed: z.boolean(),
  last_modified: z.iso.datetime({ offset: true })
});
const zCharactersMilitaryCampaignsObjectivesListing = z.looseObject({
  cursor: zCursor.optional(),
  objectives: z.array(zCharactersMilitaryCampaignsObjectivesParticipationCharacterobjective)
});
const zCharactersParagonHubSkinrItem = z.looseObject({
  created: z.iso.datetime({ offset: true }),
  expires: z.iso.datetime({ offset: true }),
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  price: z.xor([
    z.looseObject({
      isk: z.number().optional()
    }),
    z.looseObject({
      plex: z.int().optional()
    })
  ]),
  quantity: z.int(),
  seller_id: zCharacterId,
  skinr_id: z.string(),
  state: z.enum([
    "listed",
    "sold_out",
    "expired",
    "removed"
  ]),
  target: z.xor([
    z.looseObject({
      character_id: zCharacterId.optional()
    }),
    z.looseObject({
      corporation_id: zCorporationId.optional()
    }),
    z.looseObject({
      alliance_id: zAllianceId.optional()
    }),
    z.looseObject({
      public: z.boolean().optional()
    })
  ])
});
const zCharactersParagonHubSkinr = z.looseObject({
  cursor: zCursor.optional(),
  listings: z.array(zCharactersParagonHubSkinrItem)
});
const zCorporationsProjectsDetail = z.looseObject({
  configuration: z.xor([
    z.looseObject({
      capture_fw_complex: zCorporationsProjectsDetailConfigurationcapturefwcomplex.optional()
    }),
    z.looseObject({
      damage_ship: zCorporationsProjectsDetailConfigurationdamageship.optional()
    }),
    z.looseObject({
      defend_fw_complex: zCorporationsProjectsDetailConfigurationdefendfwcomplex.optional()
    }),
    z.looseObject({
      deliver_item: zCorporationsProjectsDetailConfigurationdeliveritem.optional()
    }),
    z.looseObject({
      destroy_npc: zCorporationsProjectsDetailConfigurationdestroynpc.optional()
    }),
    z.looseObject({
      destroy_ship: zCorporationsProjectsDetailConfigurationdestroyship.optional()
    }),
    z.looseObject({
      earn_loyalty_point: zCorporationsProjectsDetailConfigurationearnloyaltypoints.optional()
    }),
    z.looseObject({
      lost_ship: zCorporationsProjectsDetailConfigurationlostship.optional()
    }),
    z.looseObject({
      manual: zCorporationsProjectsDetailConfigurationmanual.optional()
    }),
    z.looseObject({
      manufacture_item: zCorporationsProjectsDetailConfigurationmanufactureitem.optional()
    }),
    z.looseObject({
      mine_material: zCorporationsProjectsDetailConfigurationminematerial.optional()
    }),
    z.looseObject({
      remote_boost_shield: zCorporationsProjectsDetailConfigurationremoteboostshield.optional()
    }),
    z.looseObject({
      remote_repair_armor: zCorporationsProjectsDetailConfigurationremoterepairarmor.optional()
    }),
    z.looseObject({
      salvage_wreck: zCorporationsProjectsDetailConfigurationsalvagewreck.optional()
    }),
    z.looseObject({
      scan_signature: zCorporationsProjectsDetailConfigurationscansignature.optional()
    }),
    z.looseObject({
      ship_insurance: zCorporationsProjectsDetailConfigurationshipinsurance.optional()
    }),
    z.looseObject({
      unknown: zCorporationsProjectsDetailConfigurationunknown.optional()
    })
  ]),
  contribution: zCorporationsProjectsDetailContribution.optional(),
  creator: zCorporationsProjectsDetailCreator,
  details: zCorporationsProjectsDetailDetails,
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  name: z.string(),
  progress: zCorporationsProjectsDetailProgress,
  reward: zCorporationsProjectsDetailReward.optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Closed",
    "Completed",
    "Expired",
    "Deleted"
  ])
});
const zCorporationsProjectsDetailProject = z.looseObject({
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  name: z.string(),
  progress: zCorporationsProjectsDetailProgress,
  reward: zCorporationsProjectsDetailReward.optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Closed",
    "Completed",
    "Expired",
    "Deleted"
  ])
});
const zCorporationsProjectsListing = z.looseObject({
  cursor: zCursor.optional(),
  projects: z.array(zCorporationsProjectsDetailProject)
});
const zFreelanceJobsDetail = z.looseObject({
  access_and_visibility: zFreelanceJobsDetailAccessandvisibility,
  configuration: zFreelanceJobsDetailConfiguration,
  contribution: zFreelanceJobsDetailContribution.optional(),
  details: zFreelanceJobsDetailDetails,
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  name: z.string(),
  progress: zFreelanceJobsDetailProgress,
  reward: zFreelanceJobsDetailReward.optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Closed",
    "Completed",
    "Expired",
    "Deleted"
  ])
});
const zFreelanceJobsDetailFreelancejob = z.looseObject({
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  name: z.string(),
  progress: zFreelanceJobsDetailProgress,
  reward: zFreelanceJobsDetailReward.optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Closed",
    "Completed",
    "Expired",
    "Deleted"
  ])
});
const zCharactersFreelanceJobsListing = z.looseObject({
  freelance_jobs: z.array(zFreelanceJobsDetailFreelancejob)
});
const zCorporationsFreelanceJobsListing = z.looseObject({
  cursor: zCursor.optional(),
  freelance_jobs: z.array(zFreelanceJobsDetailFreelancejob)
});
const zFreelanceJobsListing = z.looseObject({
  cursor: zCursor.optional(),
  freelance_jobs: z.array(zFreelanceJobsDetailFreelancejob)
});
const zMilitaryCampaignsDetail = z.looseObject({
  finished: z.iso.datetime({ offset: true }).optional(),
  id: zUuid,
  progress: z.int(),
  started: z.iso.datetime({ offset: true }).optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Completed",
    "Expired"
  ])
});
const zMilitaryCampaignsDetailCampaign = z.looseObject({
  finished: z.iso.datetime({ offset: true }).optional(),
  id: zUuid,
  progress: z.int(),
  started: z.iso.datetime({ offset: true }).optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Completed",
    "Expired"
  ])
});
const zMilitaryCampaignsListing = z.looseObject({
  campaigns: z.array(zMilitaryCampaignsDetailCampaign)
});
const zMilitaryCampaignsObjectivesDetail = z.looseObject({
  finished: z.iso.datetime({ offset: true }).optional(),
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  participants: zMilitaryCampaignsObjectivesDetailParticipants,
  progress: z.int(),
  started: z.iso.datetime({ offset: true }).optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Completed",
    "Expired"
  ])
});
const zMilitaryCampaignsObjectivesDetailObjective = z.looseObject({
  finished: z.iso.datetime({ offset: true }).optional(),
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  participants: zMilitaryCampaignsObjectivesDetailParticipants,
  progress: z.int(),
  started: z.iso.datetime({ offset: true }).optional(),
  state: z.enum([
    "Unspecified",
    "Active",
    "Completed",
    "Expired"
  ])
});
const zMilitaryCampaignsObjectivesListing = z.looseObject({
  cursor: zCursor.optional(),
  objectives: z.array(zMilitaryCampaignsObjectivesDetailObjective)
});
const zParagonHubSkinrInternalItem = z.looseObject({
  created: z.iso.datetime({ offset: true }),
  expires: z.iso.datetime({ offset: true }),
  id: zUuid,
  last_modified: z.iso.datetime({ offset: true }),
  price: z.xor([
    z.looseObject({
      isk: z.number().optional()
    }),
    z.looseObject({
      plex: z.int().optional()
    })
  ]),
  quantity: z.int(),
  seller_id: zCharacterId,
  skinr_id: z.string(),
  state: z.enum([
    "listed",
    "sold_out",
    "expired",
    "removed"
  ])
});
const zParagonHubSkinr = z.looseObject({
  cursor: zCursor.optional(),
  listings: z.array(zParagonHubSkinrInternalItem)
});
const zParagonHubSkinrAlliances = z.looseObject({
  cursor: zCursor.optional(),
  listings: z.array(zParagonHubSkinrInternalItem)
});
const zParagonHubSkinrCharacters = z.looseObject({
  cursor: zCursor.optional(),
  listings: z.array(zParagonHubSkinrInternalItem)
});
const zParagonHubSkinrCorporations = z.looseObject({
  cursor: zCursor.optional(),
  listings: z.array(zParagonHubSkinrInternalItem)
});
const zUniverseAncestriesGet = z.array(z.looseObject({
  bloodline_id: z.int(),
  description: z.string(),
  icon_id: z.int().optional(),
  id: z.int(),
  name: z.string(),
  short_description: z.string().optional()
}));
const zUniverseAsteroidBeltsAsteroidBeltIdGet = z.looseObject({
  name: z.string(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  system_id: z.int()
});
const zUniverseBloodlinesGet = z.array(z.looseObject({
  bloodline_id: z.int(),
  charisma: z.int(),
  corporation_id: z.int(),
  description: z.string(),
  intelligence: z.int(),
  memory: z.int(),
  name: z.string(),
  perception: z.int(),
  race_id: z.int(),
  ship_type_id: z.int(),
  willpower: z.int()
}));
const zUniverseCategoriesCategoryIdGet = z.looseObject({
  category_id: z.int(),
  groups: z.array(z.int()),
  name: z.string(),
  published: z.boolean()
});
const zUniverseCategoriesGet = z.array(z.int());
const zUniverseConstellationsConstellationIdGet = z.looseObject({
  constellation_id: z.int(),
  name: z.string(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  region_id: z.int(),
  systems: z.array(z.int())
});
const zUniverseConstellationsGet = z.array(z.int());
const zUniverseFactionsGet = z.array(z.looseObject({
  corporation_id: z.int().optional(),
  description: z.string(),
  faction_id: z.int(),
  is_unique: z.boolean(),
  militia_corporation_id: z.int().optional(),
  name: z.string(),
  size_factor: z.number(),
  solar_system_id: z.int().optional(),
  station_count: z.int(),
  station_system_count: z.int()
}));
const zUniverseGraphicsGet = z.array(z.int());
const zUniverseGraphicsGraphicIdGet = z.looseObject({
  collision_file: z.string().optional(),
  graphic_file: z.string().optional(),
  graphic_id: z.int(),
  icon_folder: z.string().optional(),
  sof_dna: z.string().optional(),
  sof_fation_name: z.string().optional(),
  sof_hull_name: z.string().optional(),
  sof_race_name: z.string().optional()
});
const zUniverseGroupsGet = z.array(z.int());
const zUniverseGroupsGroupIdGet = z.looseObject({
  category_id: z.int(),
  group_id: z.int(),
  name: z.string(),
  published: z.boolean(),
  types: z.array(z.int())
});
const zUniverseIdsPost = z.looseObject({
  agents: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  alliances: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  characters: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  constellations: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  corporations: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  factions: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  inventory_types: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  regions: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  stations: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional(),
  systems: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional()
  })).optional()
});
const zUniverseMoonsMoonIdGet = z.looseObject({
  moon_id: z.int(),
  name: z.string(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  system_id: z.int()
});
const zUniverseNamesPost = z.array(z.looseObject({
  category: z.enum([
    "alliance",
    "character",
    "constellation",
    "corporation",
    "inventory_type",
    "region",
    "solar_system",
    "station",
    "faction"
  ]),
  id: z.int(),
  name: z.string()
}));
const zUniversePlanetsPlanetIdGet = z.looseObject({
  name: z.string(),
  planet_id: z.int(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  system_id: z.int(),
  type_id: z.int()
});
const zUniverseRacesGet = z.array(z.looseObject({
  alliance_id: z.int(),
  description: z.string(),
  name: z.string(),
  race_id: z.int()
}));
const zUniverseRegionsGet = z.array(z.int());
const zUniverseRegionsRegionIdGet = z.looseObject({
  constellations: z.array(z.int()),
  description: z.string().optional(),
  name: z.string(),
  region_id: z.int()
});
const zUniverseSchematicsSchematicIdGet = z.looseObject({
  cycle_time: z.int(),
  schematic_name: z.string()
});
const zUniverseStargatesStargateIdGet = z.looseObject({
  destination: z.looseObject({
    stargate_id: z.int(),
    system_id: z.int()
  }),
  name: z.string(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  stargate_id: z.int(),
  system_id: z.int(),
  type_id: z.int()
});
const zUniverseStarsStarIdGet = z.looseObject({
  age: z.int(),
  luminosity: z.number(),
  name: z.string(),
  radius: z.int(),
  solar_system_id: z.int(),
  spectral_class: z.enum([
    "K2 V",
    "K4 V",
    "G2 V",
    "G8 V",
    "M7 V",
    "K7 V",
    "M2 V",
    "K5 V",
    "M3 V",
    "G0 V",
    "G7 V",
    "G3 V",
    "F9 V",
    "G5 V",
    "F6 V",
    "K8 V",
    "K9 V",
    "K6 V",
    "G9 V",
    "G6 V",
    "G4 VI",
    "G4 V",
    "F8 V",
    "F2 V",
    "F1 V",
    "K3 V",
    "F0 VI",
    "G1 VI",
    "G0 VI",
    "K1 V",
    "M4 V",
    "M1 V",
    "M6 V",
    "M0 V",
    "K2 IV",
    "G2 VI",
    "K0 V",
    "K5 IV",
    "F5 VI",
    "G6 VI",
    "F6 VI",
    "F2 IV",
    "G3 VI",
    "M8 V",
    "F1 VI",
    "K1 IV",
    "F7 V",
    "G5 VI",
    "M5 V",
    "G7 VI",
    "F5 V",
    "F4 VI",
    "F8 VI",
    "K3 IV",
    "F4 IV",
    "F0 V",
    "G7 IV",
    "G8 VI",
    "F2 VI",
    "F4 V",
    "F7 VI",
    "F3 V",
    "G1 V",
    "G9 VI",
    "F3 IV",
    "F9 VI",
    "M9 V",
    "K0 IV",
    "F1 IV",
    "G4 IV",
    "F3 VI",
    "K4 IV",
    "G5 IV",
    "G3 IV",
    "G1 IV",
    "K7 IV",
    "G0 IV",
    "K6 IV",
    "K9 IV",
    "G2 IV",
    "F9 IV",
    "F0 IV",
    "K8 IV",
    "G8 IV",
    "F6 IV",
    "F5 IV",
    "A0",
    "A0IV",
    "A0IV2"
  ]),
  temperature: z.int(),
  type_id: z.int()
});
const zUniverseStationsStationIdGet = z.looseObject({
  max_dockable_ship_volume: z.number(),
  name: z.string(),
  office_rental_cost: z.number(),
  owner: z.int().optional(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  race_id: z.int().optional(),
  reprocessing_efficiency: z.number(),
  reprocessing_stations_take: z.number(),
  services: z.array(z.enum([
    "bounty-missions",
    "assasination-missions",
    "courier-missions",
    "interbus",
    "reprocessing-plant",
    "refinery",
    "market",
    "black-market",
    "stock-exchange",
    "cloning",
    "surgery",
    "dna-therapy",
    "repair-facilities",
    "factory",
    "labratory",
    "gambling",
    "fitting",
    "paintshop",
    "news",
    "storage",
    "insurance",
    "docking",
    "office-rental",
    "jump-clone-facility",
    "loyalty-point-store",
    "navy-offices",
    "security-offices"
  ])),
  station_id: z.int(),
  system_id: z.int(),
  type_id: z.int()
});
const zUniverseStructuresGet = z.array(z.int()).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zUniverseStructuresStructureIdGet = z.looseObject({
  name: z.string(),
  owner_id: z.int(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }).optional(),
  solar_system_id: z.int(),
  type_id: z.int().optional()
});
const zUniverseSystemJumpsGet = z.array(z.looseObject({
  ship_jumps: z.int(),
  system_id: z.int()
}));
const zUniverseSystemKillsGet = z.array(z.looseObject({
  npc_kills: z.int(),
  pod_kills: z.int(),
  ship_kills: z.int(),
  system_id: z.int()
}));
const zUniverseSystemsGet = z.array(z.int());
const zUniverseSystemsSystemIdGet = z.looseObject({
  constellation_id: z.int(),
  name: z.string(),
  planets: z.array(z.looseObject({
    asteroid_belts: z.array(z.int()).optional(),
    moons: z.array(z.int()).optional(),
    planet_id: z.int()
  })).optional(),
  position: z.looseObject({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  security_class: z.string().optional(),
  security_status: z.number(),
  star_id: z.int().optional(),
  stargates: z.array(z.int()).optional(),
  stations: z.array(z.int()).optional(),
  system_id: z.int()
});
const zUniverseTypesGet = z.array(z.int());
const zUniverseTypesTypeIdGet = z.looseObject({
  capacity: z.number().optional(),
  description: z.string(),
  dogma_attributes: z.array(z.looseObject({
    attribute_id: z.int(),
    value: z.number()
  })).optional(),
  dogma_effects: z.array(z.looseObject({
    effect_id: z.int(),
    is_default: z.boolean()
  })).optional(),
  graphic_id: z.int().optional(),
  group_id: z.int(),
  icon_id: z.int().optional(),
  market_group_id: z.int().optional(),
  mass: z.number().optional(),
  name: z.string(),
  packaged_volume: z.number().optional(),
  portion_size: z.int().optional(),
  published: z.boolean(),
  radius: z.number().optional(),
  type_id: z.int(),
  volume: z.number().optional()
});
const zWarsGet = z.array(z.int());
const zWarsWarIdGet = z.looseObject({
  aggressor: z.looseObject({
    alliance_id: z.int().optional(),
    corporation_id: z.int().optional(),
    isk_destroyed: z.number(),
    ships_killed: z.int()
  }),
  allies: z.array(z.looseObject({
    alliance_id: z.int().optional(),
    corporation_id: z.int().optional()
  })).optional(),
  declared: z.iso.datetime({ offset: true }),
  defender: z.looseObject({
    alliance_id: z.int().optional(),
    corporation_id: z.int().optional(),
    isk_destroyed: z.number(),
    ships_killed: z.int()
  }),
  finished: z.iso.datetime({ offset: true }).optional(),
  id: z.int(),
  mutual: z.boolean(),
  open_for_allies: z.boolean(),
  retracted: z.iso.datetime({ offset: true }).optional(),
  started: z.iso.datetime({ offset: true }).optional()
});
const zWarsWarIdKillmailsGet = z.array(z.looseObject({
  killmail_hash: z.string(),
  killmail_id: z.int()
}));
const zAcceptLanguage = z.enum([
  "en",
  "de",
  "fr",
  "ja",
  "ru",
  "zh",
  "ko",
  "es"
]).default("en");
const zCompatibilityDate2 = z.enum(["2026-08-18"]);
const zIfModifiedSince = z.string();
const zIfNoneMatch = z.string();
const zTenant = z.string().default("tranquility");
const zGetAlliancesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetAlliancesResponse = zAlliancesGet;
const zGetAlliancesAllianceIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetAlliancesAllianceIdPath = z.looseObject({
  alliance_id: zAllianceId
});
const zGetAlliancesAllianceIdResponse = zAllianceDetail;
const zGetAlliancesAllianceIdContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetAlliancesAllianceIdContactsPath = z.looseObject({
  alliance_id: zAllianceId
});
const zGetAlliancesAllianceIdContactsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetAlliancesAllianceIdContactsResponse = zAlliancesAllianceIdContactsGet;
const zGetAlliancesAllianceIdContactsLabelsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetAlliancesAllianceIdContactsLabelsPath = z.looseObject({
  alliance_id: zAllianceId
});
const zGetAlliancesAllianceIdContactsLabelsResponse = zAlliancesAllianceIdContactsLabelsGet;
const zGetAlliancesAllianceIdCorporationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetAlliancesAllianceIdCorporationsPath = z.looseObject({
  alliance_id: zAllianceId
});
const zGetAlliancesAllianceIdCorporationsResponse = zAlliancesAllianceIdCorporationsGet;
const zGetAlliancesAllianceIdIconsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetAlliancesAllianceIdIconsPath = z.looseObject({
  alliance_id: zAllianceId
});
const zGetAlliancesAllianceIdIconsResponse = zAlliancesAllianceIdIconsGet;
const zPostCharactersAffiliationBody = z.array(z.int()).min(1).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostCharactersAffiliationHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersAffiliationResponse = zCharactersAffiliationPost;
const zGetCharactersDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersDetailPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersDetailResponse = zCharactersDetail;
const zGetCharactersAccessListsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersAccessListsListingPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersAccessListsListingResponse = zCharactersAccessListsListing;
const zGetCharactersAccessListsDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersAccessListsDetailPath = z.looseObject({
  access_list_id: zAccessListId,
  character_id: zCharacterId
});
const zGetCharactersAccessListsDetailResponse = zCharactersAccessListsDetail;
const zGetCharactersCharacterIdAgentsResearchHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdAgentsResearchPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdAgentsResearchResponse = zCharactersCharacterIdAgentsResearchGet;
const zGetCharactersCharacterIdAssetsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdAssetsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdAssetsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdAssetsResponse = zCharactersCharacterIdAssetsGet;
const zPostCharactersCharacterIdAssetsLocationsBody = z.array(z.int()).min(1).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostCharactersCharacterIdAssetsLocationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdAssetsLocationsPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdAssetsLocationsResponse = zCharactersCharacterIdAssetsLocationsPost;
const zPostCharactersCharacterIdAssetsNamesBody = z.array(z.int()).min(1).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostCharactersCharacterIdAssetsNamesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdAssetsNamesPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdAssetsNamesResponse = zCharactersCharacterIdAssetsNamesPost;
const zGetCharactersCharacterIdAttributesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdAttributesPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdAttributesResponse = zCharactersCharacterIdAttributesGet;
const zGetCharactersCharacterIdBlueprintsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdBlueprintsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdBlueprintsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdBlueprintsResponse = zCharactersCharacterIdBlueprintsGet;
const zGetCharactersCharacterIdCalendarHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdCalendarPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdCalendarQuery = z.looseObject({
  from_event: z.int().optional()
});
const zGetCharactersCharacterIdCalendarResponse = zCharactersCharacterIdCalendarGet;
const zGetCharactersCharacterIdCalendarEventIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdCalendarEventIdPath = z.looseObject({
  character_id: zCharacterId,
  event_id: z.int()
});
const zGetCharactersCharacterIdCalendarEventIdResponse = zCharactersCharacterIdCalendarEventIdGet;
const zPutCharactersCharacterIdCalendarEventIdBody = z.looseObject({
  response: z.enum([
    "accepted",
    "declined",
    "tentative"
  ])
});
const zPutCharactersCharacterIdCalendarEventIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutCharactersCharacterIdCalendarEventIdPath = z.looseObject({
  character_id: zCharacterId,
  event_id: z.int()
});
const zPutCharactersCharacterIdCalendarEventIdResponse = z.undefined();
const zGetCharactersCharacterIdCalendarEventIdAttendeesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdCalendarEventIdAttendeesPath = z.looseObject({
  character_id: zCharacterId,
  event_id: z.int()
});
const zGetCharactersCharacterIdCalendarEventIdAttendeesResponse = zCharactersCharacterIdCalendarEventIdAttendeesGet;
const zGetCharactersCharacterIdClonesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdClonesPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdClonesResponse = zCharactersCharacterIdClonesGet;
const zDeleteCharactersCharacterIdContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteCharactersCharacterIdContactsPath = z.looseObject({
  character_id: zCharacterId
});
const zDeleteCharactersCharacterIdContactsQuery = z.looseObject({
  contact_ids: z.array(z.int()).min(1).max(20)
});
const zDeleteCharactersCharacterIdContactsResponse = z.undefined();
const zGetCharactersCharacterIdContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdContactsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdContactsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdContactsResponse = zCharactersCharacterIdContactsGet;
const zPostCharactersCharacterIdContactsBody = z.array(z.int()).min(1).max(100);
const zPostCharactersCharacterIdContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdContactsPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdContactsQuery = z.looseObject({
  label_ids: z.array(z.int()).max(63).optional(),
  standing: z.number(),
  watched: z.boolean().optional().default(false)
});
const zPostCharactersCharacterIdContactsResponse = zCharactersCharacterIdContactsPost;
const zPutCharactersCharacterIdContactsBody = z.array(z.int()).min(1).max(100);
const zPutCharactersCharacterIdContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutCharactersCharacterIdContactsPath = z.looseObject({
  character_id: zCharacterId
});
const zPutCharactersCharacterIdContactsQuery = z.looseObject({
  label_ids: z.array(z.int()).max(63).optional(),
  standing: z.number(),
  watched: z.boolean().optional().default(false)
});
const zPutCharactersCharacterIdContactsResponse = z.undefined();
const zGetCharactersCharacterIdContactsLabelsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdContactsLabelsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdContactsLabelsResponse = zCharactersCharacterIdContactsLabelsGet;
const zGetCharactersCharacterIdContractsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdContractsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdContractsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdContractsResponse = zCharactersCharacterIdContractsGet;
const zGetCharactersCharacterIdContractsContractIdBidsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdContractsContractIdBidsPath = z.looseObject({
  character_id: zCharacterId,
  contract_id: z.int()
});
const zGetCharactersCharacterIdContractsContractIdBidsResponse = zCharactersCharacterIdContractsContractIdBidsGet;
const zGetCharactersCharacterIdContractsContractIdItemsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdContractsContractIdItemsPath = z.looseObject({
  character_id: zCharacterId,
  contract_id: z.int()
});
const zGetCharactersCharacterIdContractsContractIdItemsResponse = zCharactersCharacterIdContractsContractIdItemsGet;
const zGetCharactersCharacterIdCorporationhistoryHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdCorporationhistoryPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdCorporationhistoryResponse = zCharactersCharacterIdCorporationhistoryGet;
const zGetCharactersCosmeticsSkinrHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCosmeticsSkinrPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCosmeticsSkinrResponse = zCharactersCosmeticsSkinr;
const zGetCharactersCosmeticsSkinrComponentsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCosmeticsSkinrComponentsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCosmeticsSkinrComponentsResponse = zCharactersCosmeticsSkinrComponents;
const zPostCharactersCharacterIdCspaBody = z.array(z.int()).min(1).max(100).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostCharactersCharacterIdCspaHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdCspaPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdCspaResponse = zCharactersCharacterIdCspaPost;
const zGetCharactersCharacterIdFatigueHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdFatiguePath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdFatigueResponse = zCharactersCharacterIdFatigueGet;
const zGetCharactersCharacterIdFittingsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdFittingsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdFittingsResponse = zCharactersCharacterIdFittingsGet;
const zPostCharactersCharacterIdFittingsBody = z.looseObject({
  description: z.string().max(500),
  items: z.array(z.looseObject({
    flag: z.enum([
      "Cargo",
      "DroneBay",
      "FighterBay",
      "HiSlot0",
      "HiSlot1",
      "HiSlot2",
      "HiSlot3",
      "HiSlot4",
      "HiSlot5",
      "HiSlot6",
      "HiSlot7",
      "Invalid",
      "LoSlot0",
      "LoSlot1",
      "LoSlot2",
      "LoSlot3",
      "LoSlot4",
      "LoSlot5",
      "LoSlot6",
      "LoSlot7",
      "MedSlot0",
      "MedSlot1",
      "MedSlot2",
      "MedSlot3",
      "MedSlot4",
      "MedSlot5",
      "MedSlot6",
      "MedSlot7",
      "RigSlot0",
      "RigSlot1",
      "RigSlot2",
      "ServiceSlot0",
      "ServiceSlot1",
      "ServiceSlot2",
      "ServiceSlot3",
      "ServiceSlot4",
      "ServiceSlot5",
      "ServiceSlot6",
      "ServiceSlot7",
      "SubSystemSlot0",
      "SubSystemSlot1",
      "SubSystemSlot2",
      "SubSystemSlot3"
    ]),
    quantity: z.int(),
    type_id: z.int()
  })).min(1).max(512),
  name: z.string().min(1).max(50),
  ship_type_id: z.int()
});
const zPostCharactersCharacterIdFittingsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdFittingsPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdFittingsResponse = zCharactersCharacterIdFittingsPost;
const zDeleteCharactersCharacterIdFittingsFittingIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteCharactersCharacterIdFittingsFittingIdPath = z.looseObject({
  character_id: zCharacterId,
  fitting_id: z.int()
});
const zDeleteCharactersCharacterIdFittingsFittingIdResponse = z.undefined();
const zGetCharactersCharacterIdFleetHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdFleetPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdFleetResponse = zCharactersCharacterIdFleetGet;
const zGetCharactersFreelanceJobsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersFreelanceJobsListingPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersFreelanceJobsListingResponse = zCharactersFreelanceJobsListing;
const zGetCharactersFreelanceJobsParticipationHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersFreelanceJobsParticipationPath = z.looseObject({
  character_id: zCharacterId,
  job_id: zUuid
});
const zGetCharactersFreelanceJobsParticipationResponse = zCharactersFreelanceJobsParticipation;
const zGetCharactersCharacterIdFwStatsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdFwStatsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdFwStatsResponse = zCharactersCharacterIdFwStatsGet;
const zGetCharactersCharacterIdImplantsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdImplantsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdImplantsResponse = zCharactersCharacterIdImplantsGet;
const zGetCharactersCharacterIdIndustryJobsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdIndustryJobsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdIndustryJobsQuery = z.looseObject({
  include_completed: z.boolean().optional()
});
const zGetCharactersCharacterIdIndustryJobsResponse = zCharactersCharacterIdIndustryJobsGet;
const zGetCharactersCharacterIdKillmailsRecentHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdKillmailsRecentPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdKillmailsRecentQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdKillmailsRecentResponse = zCharactersCharacterIdKillmailsRecentGet;
const zGetCharactersCharacterIdLocationHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdLocationPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdLocationResponse = zCharactersCharacterIdLocationGet;
const zGetCharactersCharacterIdLoyaltyPointsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdLoyaltyPointsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdLoyaltyPointsResponse = zCharactersCharacterIdLoyaltyPointsGet;
const zGetCharactersCharacterIdMailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdMailPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdMailQuery = z.looseObject({
  labels: z.array(z.int()).min(1).max(25).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  last_mail_id: z.int().optional()
});
const zGetCharactersCharacterIdMailResponse = zCharactersCharacterIdMailGet;
const zPostCharactersCharacterIdMailBody = z.looseObject({
  approved_cost: z.int().optional().default(0),
  body: z.string().max(1e4),
  recipients: z.array(z.looseObject({
    recipient_id: z.int(),
    recipient_type: z.enum([
      "alliance",
      "character",
      "corporation",
      "mailing_list"
    ])
  })).min(1).max(50),
  subject: z.string().max(1e3)
});
const zPostCharactersCharacterIdMailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdMailPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdMailResponse = zCharactersCharacterIdMailPost;
const zGetCharactersCharacterIdMailLabelsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdMailLabelsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdMailLabelsResponse = zCharactersCharacterIdMailLabelsGet;
const zPostCharactersCharacterIdMailLabelsBody = z.looseObject({
  color: z.enum([
    "#0000fe",
    "#006634",
    "#0099ff",
    "#00ff33",
    "#01ffff",
    "#349800",
    "#660066",
    "#666666",
    "#999999",
    "#99ffff",
    "#9a0000",
    "#ccff9a",
    "#e6e6e6",
    "#fe0000",
    "#ff6600",
    "#ffff01",
    "#ffffcd",
    "#ffffff"
  ]).optional().default("#ffffff"),
  name: z.string().min(1).max(40)
});
const zPostCharactersCharacterIdMailLabelsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCharactersCharacterIdMailLabelsPath = z.looseObject({
  character_id: zCharacterId
});
const zPostCharactersCharacterIdMailLabelsResponse = zCharactersCharacterIdMailLabelsPost;
const zDeleteCharactersCharacterIdMailLabelsLabelIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteCharactersCharacterIdMailLabelsLabelIdPath = z.looseObject({
  character_id: zCharacterId,
  label_id: z.int()
});
const zDeleteCharactersCharacterIdMailLabelsLabelIdResponse = z.undefined();
const zGetCharactersCharacterIdMailListsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdMailListsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdMailListsResponse = zCharactersCharacterIdMailListsGet;
const zDeleteCharactersCharacterIdMailMailIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteCharactersCharacterIdMailMailIdPath = z.looseObject({
  character_id: zCharacterId,
  mail_id: z.int()
});
const zDeleteCharactersCharacterIdMailMailIdResponse = z.undefined();
const zGetCharactersCharacterIdMailMailIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdMailMailIdPath = z.looseObject({
  character_id: zCharacterId,
  mail_id: z.int()
});
const zGetCharactersCharacterIdMailMailIdResponse = zCharactersCharacterIdMailMailIdGet;
const zPutCharactersCharacterIdMailMailIdBody = z.looseObject({
  labels: z.array(z.int()).max(25).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }).optional(),
  read: z.boolean().optional()
});
const zPutCharactersCharacterIdMailMailIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutCharactersCharacterIdMailMailIdPath = z.looseObject({
  character_id: zCharacterId,
  mail_id: z.int()
});
const zPutCharactersCharacterIdMailMailIdResponse = z.undefined();
const zGetCharactersCharacterIdMedalsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdMedalsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdMedalsResponse = zCharactersCharacterIdMedalsGet;
const zGetCharactersMercenaryTacticalOperationsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersMercenaryTacticalOperationsListingPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersMercenaryTacticalOperationsListingResponse = zCharactersMercenaryTacticalOperationsListing;
const zGetCharactersMercenaryTacticalOperationsDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersMercenaryTacticalOperationsDetailPath = z.looseObject({
  operation_id: zUuid,
  character_id: zCharacterId
});
const zGetCharactersMercenaryTacticalOperationsDetailResponse = zCharactersMercenaryTacticalOperationsDetail;
const zGetCharactersMilitaryCampaignsObjectivesListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersMilitaryCampaignsObjectivesListingPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersMilitaryCampaignsObjectivesListingQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetCharactersMilitaryCampaignsObjectivesListingResponse = zCharactersMilitaryCampaignsObjectivesListing;
const zGetCharactersMilitaryCampaignsObjectivesParticipationHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersMilitaryCampaignsObjectivesParticipationPath = z.looseObject({
  character_id: zCharacterId,
  objective_id: zUuid
});
const zGetCharactersMilitaryCampaignsObjectivesParticipationResponse = zCharactersMilitaryCampaignsObjectivesParticipation;
const zGetCharactersCharacterIdMiningHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdMiningPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdMiningQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdMiningResponse = zCharactersCharacterIdMiningGet;
const zGetCharactersCharacterIdNotificationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdNotificationsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdNotificationsResponse = zCharactersCharacterIdNotificationsGet;
const zGetCharactersCharacterIdNotificationsContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdNotificationsContactsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdNotificationsContactsResponse = zCharactersCharacterIdNotificationsContactsGet;
const zGetCharactersCharacterIdOnlineHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdOnlinePath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdOnlineResponse = zCharactersCharacterIdOnlineGet;
const zGetCharactersCharacterIdOrdersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdOrdersPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdOrdersResponse = zCharactersCharacterIdOrdersGet;
const zGetCharactersCharacterIdOrdersHistoryHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdOrdersHistoryPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdOrdersHistoryQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdOrdersHistoryResponse = zCharactersCharacterIdOrdersHistoryGet;
const zGetCharactersParagonHubSkinrHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersParagonHubSkinrPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersParagonHubSkinrQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetCharactersParagonHubSkinrResponse = zCharactersParagonHubSkinr;
const zGetCharactersCharacterIdPlanetsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdPlanetsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdPlanetsResponse = zCharactersCharacterIdPlanetsGet;
const zGetCharactersCharacterIdPlanetsPlanetIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdPlanetsPlanetIdPath = z.looseObject({
  character_id: zCharacterId,
  planet_id: z.int()
});
const zGetCharactersCharacterIdPlanetsPlanetIdResponse = zCharactersCharacterIdPlanetsPlanetIdGet;
const zGetCharactersCharacterIdPortraitHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdPortraitPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdPortraitResponse = zCharactersCharacterIdPortraitGet;
const zGetCharactersCharacterIdRolesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdRolesPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdRolesResponse = zCharactersCharacterIdRolesGet;
const zGetCharactersCharacterIdSearchHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdSearchPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdSearchQuery = z.looseObject({
  categories: z.array(z.enum([
    "agent",
    "alliance",
    "character",
    "constellation",
    "corporation",
    "faction",
    "inventory_type",
    "region",
    "solar_system",
    "station",
    "structure"
  ])).min(1).max(11).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" }),
  search: z.string().min(3),
  strict: z.boolean().optional().default(false)
});
const zGetCharactersCharacterIdSearchResponse = zCharactersCharacterIdSearchGet;
const zGetCharactersCharacterIdShipHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdShipPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdShipResponse = zCharactersCharacterIdShipGet;
const zGetCharactersCharacterIdSkillqueueHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdSkillqueuePath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdSkillqueueResponse = z.array(zCharactersSkillqueueSkill);
const zGetCharactersCharacterIdSkillsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdSkillsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdSkillsResponse = zCharactersSkills;
const zGetCharactersCharacterIdStandingsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdStandingsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdStandingsResponse = zCharactersCharacterIdStandingsGet;
const zGetCharactersStructuresMercenaryDensListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersStructuresMercenaryDensListingPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersStructuresMercenaryDensListingResponse = zCharactersStructuresMercenaryDensListing;
const zGetCharactersStructuresMercenaryDensDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersStructuresMercenaryDensDetailPath = z.looseObject({
  mercenary_den_id: zItemId,
  character_id: zCharacterId
});
const zGetCharactersStructuresMercenaryDensDetailResponse = zCharactersStructuresMercenaryDensDetail;
const zGetCharactersCharacterIdTitlesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdTitlesPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdTitlesResponse = zCharactersCharacterIdTitlesGet;
const zGetCharactersCharacterIdWalletHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdWalletPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdWalletResponse = zCharactersCharacterIdWalletGet;
const zGetCharactersCharacterIdWalletJournalHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdWalletJournalPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdWalletJournalQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCharactersCharacterIdWalletJournalResponse = zCharactersCharacterIdWalletJournalGet;
const zGetCharactersCharacterIdWalletTransactionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCharactersCharacterIdWalletTransactionsPath = z.looseObject({
  character_id: zCharacterId
});
const zGetCharactersCharacterIdWalletTransactionsQuery = z.looseObject({
  from_id: z.int().optional()
});
const zGetCharactersCharacterIdWalletTransactionsResponse = zCharactersCharacterIdWalletTransactionsGet;
const zGetContractsPublicBidsContractIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetContractsPublicBidsContractIdPath = z.looseObject({
  contract_id: z.int()
});
const zGetContractsPublicBidsContractIdQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetContractsPublicBidsContractIdResponse = z.union([
  zContractsPublicBidsContractIdGet,
  z.undefined()
]);
const zGetContractsPublicItemsContractIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetContractsPublicItemsContractIdPath = z.looseObject({
  contract_id: z.int()
});
const zGetContractsPublicItemsContractIdQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetContractsPublicItemsContractIdResponse = z.union([
  zContractsPublicItemsContractIdGet,
  z.undefined()
]);
const zGetContractsPublicRegionIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetContractsPublicRegionIdPath = z.looseObject({
  region_id: z.int()
});
const zGetContractsPublicRegionIdQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetContractsPublicRegionIdResponse = zContractsPublicRegionIdGet;
const zGetCorporationCorporationIdMiningExtractionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationCorporationIdMiningExtractionsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationCorporationIdMiningExtractionsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationCorporationIdMiningExtractionsResponse = zCorporationCorporationIdMiningExtractionsGet;
const zGetCorporationCorporationIdMiningObserversHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationCorporationIdMiningObserversPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationCorporationIdMiningObserversQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationCorporationIdMiningObserversResponse = zCorporationCorporationIdMiningObserversGet;
const zGetCorporationCorporationIdMiningObserversObserverIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationCorporationIdMiningObserversObserverIdPath = z.looseObject({
  corporation_id: zCorporationId,
  observer_id: z.int()
});
const zGetCorporationCorporationIdMiningObserversObserverIdQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationCorporationIdMiningObserversObserverIdResponse = zCorporationCorporationIdMiningObserversObserverIdGet;
const zGetCorporationsNpccorpsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsNpccorpsResponse = zCorporationsNpccorpsGet;
const zGetCorporationsCorporationIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdResponse = zCorporationsDetail;
const zGetCorporationsCorporationIdAlliancehistoryHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdAlliancehistoryPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdAlliancehistoryResponse = zCorporationsCorporationIdAlliancehistoryGet;
const zGetCorporationsCorporationIdAssetsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdAssetsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdAssetsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdAssetsResponse = zCorporationsCorporationIdAssetsGet;
const zPostCorporationsCorporationIdAssetsLocationsBody = z.array(z.int()).min(1).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostCorporationsCorporationIdAssetsLocationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCorporationsCorporationIdAssetsLocationsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zPostCorporationsCorporationIdAssetsLocationsResponse = zCorporationsCorporationIdAssetsLocationsPost;
const zPostCorporationsCorporationIdAssetsNamesBody = z.array(z.int()).min(1).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostCorporationsCorporationIdAssetsNamesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostCorporationsCorporationIdAssetsNamesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zPostCorporationsCorporationIdAssetsNamesResponse = zCorporationsCorporationIdAssetsNamesPost;
const zGetCorporationsCorporationIdBlueprintsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdBlueprintsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdBlueprintsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdBlueprintsResponse = zCorporationsCorporationIdBlueprintsGet;
const zGetCorporationsCorporationIdContactsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdContactsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdContactsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdContactsResponse = zCorporationsCorporationIdContactsGet;
const zGetCorporationsCorporationIdContactsLabelsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdContactsLabelsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdContactsLabelsResponse = zCorporationsCorporationIdContactsLabelsGet;
const zGetCorporationsCorporationIdContainersLogsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdContainersLogsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdContainersLogsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdContainersLogsResponse = zCorporationsCorporationIdContainersLogsGet;
const zGetCorporationsCorporationIdContractsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdContractsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdContractsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdContractsResponse = zCorporationsCorporationIdContractsGet;
const zGetCorporationsCorporationIdContractsContractIdBidsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdContractsContractIdBidsPath = z.looseObject({
  contract_id: z.int(),
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdContractsContractIdBidsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdContractsContractIdBidsResponse = zCorporationsCorporationIdContractsContractIdBidsGet;
const zGetCorporationsCorporationIdContractsContractIdItemsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdContractsContractIdItemsPath = z.looseObject({
  contract_id: z.int(),
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdContractsContractIdItemsResponse = zCorporationsCorporationIdContractsContractIdItemsGet;
const zGetCorporationsCorporationIdCustomsOfficesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdCustomsOfficesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdCustomsOfficesQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdCustomsOfficesResponse = zCorporationsCorporationIdCustomsOfficesGet;
const zGetCorporationsCorporationIdDivisionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdDivisionsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdDivisionsResponse = zCorporationsCorporationIdDivisionsGet;
const zGetCorporationsCorporationIdFacilitiesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdFacilitiesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdFacilitiesResponse = zCorporationsCorporationIdFacilitiesGet;
const zGetCorporationsFreelanceJobsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsFreelanceJobsListingPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsFreelanceJobsListingQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetCorporationsFreelanceJobsListingResponse = zCorporationsFreelanceJobsListing;
const zGetCorporationsFreelanceJobsParticipantsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsFreelanceJobsParticipantsPath = z.looseObject({
  corporation_id: zCorporationId,
  job_id: zUuid
});
const zGetCorporationsFreelanceJobsParticipantsQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetCorporationsFreelanceJobsParticipantsResponse = zCorporationsFreelanceJobsParticipants;
const zGetCorporationsCorporationIdFwStatsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdFwStatsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdFwStatsResponse = zCorporationsCorporationIdFwStatsGet;
const zGetCorporationsCorporationIdIconsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdIconsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdIconsResponse = zCorporationsCorporationIdIconsGet;
const zGetCorporationsCorporationIdIndustryJobsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdIndustryJobsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdIndustryJobsQuery = z.looseObject({
  include_completed: z.boolean().optional().default(false),
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdIndustryJobsResponse = zCorporationsCorporationIdIndustryJobsGet;
const zGetCorporationsCorporationIdKillmailsRecentHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdKillmailsRecentPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdKillmailsRecentQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdKillmailsRecentResponse = zCorporationsCorporationIdKillmailsRecentGet;
const zGetCorporationsCorporationIdMedalsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdMedalsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdMedalsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdMedalsResponse = zCorporationsCorporationIdMedalsGet;
const zGetCorporationsCorporationIdMedalsIssuedHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdMedalsIssuedPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdMedalsIssuedQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdMedalsIssuedResponse = zCorporationsCorporationIdMedalsIssuedGet;
const zGetCorporationsCorporationIdMembersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdMembersPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdMembersResponse = zCorporationsCorporationIdMembersGet;
const zGetCorporationsCorporationIdMembersLimitHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdMembersLimitPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdMembersLimitResponse = zCorporationsCorporationIdMembersLimitGet;
const zGetCorporationsCorporationIdMembersTitlesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdMembersTitlesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdMembersTitlesResponse = zCorporationsCorporationIdMembersTitlesGet;
const zGetCorporationsCorporationIdMembertrackingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdMembertrackingPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdMembertrackingResponse = zCorporationsCorporationIdMembertrackingGet;
const zGetCorporationsCorporationIdOrdersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdOrdersPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdOrdersQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdOrdersResponse = zCorporationsCorporationIdOrdersGet;
const zGetCorporationsCorporationIdOrdersHistoryHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdOrdersHistoryPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdOrdersHistoryQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdOrdersHistoryResponse = zCorporationsCorporationIdOrdersHistoryGet;
const zGetCorporationsProjectsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsProjectsListingPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsProjectsListingQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10),
  state: z.enum(["All", "Active"]).optional().default("Active")
});
const zGetCorporationsProjectsListingResponse = zCorporationsProjectsListing;
const zGetCorporationsProjectsDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsProjectsDetailPath = z.looseObject({
  corporation_id: zCorporationId,
  project_id: zUuid
});
const zGetCorporationsProjectsDetailResponse = zCorporationsProjectsDetail;
const zGetCorporationsProjectsContributionHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsProjectsContributionPath = z.looseObject({
  corporation_id: zCorporationId,
  project_id: zUuid,
  character_id: zCharacterId
});
const zGetCorporationsProjectsContributionResponse = zCorporationsProjectsContribution;
const zGetCorporationsProjectsContributorsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsProjectsContributorsPath = z.looseObject({
  corporation_id: zCorporationId,
  project_id: zUuid
});
const zGetCorporationsProjectsContributorsQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetCorporationsProjectsContributorsResponse = zCorporationsProjectsContributors;
const zGetCorporationsCorporationIdRolesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdRolesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdRolesResponse = zCorporationsCorporationIdRolesGet;
const zGetCorporationsCorporationIdRolesHistoryHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdRolesHistoryPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdRolesHistoryQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdRolesHistoryResponse = zCorporationsCorporationIdRolesHistoryGet;
const zGetCorporationsCorporationIdShareholdersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdShareholdersPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdShareholdersQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdShareholdersResponse = zCorporationsCorporationIdShareholdersGet;
const zGetCorporationsCorporationIdStandingsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdStandingsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdStandingsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdStandingsResponse = zCorporationsCorporationIdStandingsGet;
const zGetCorporationsCorporationIdStarbasesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdStarbasesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdStarbasesQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdStarbasesResponse = zCorporationsCorporationIdStarbasesGet;
const zGetCorporationsCorporationIdStarbasesStarbaseIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdStarbasesStarbaseIdPath = z.looseObject({
  corporation_id: zCorporationId,
  starbase_id: z.int()
});
const zGetCorporationsCorporationIdStarbasesStarbaseIdQuery = z.looseObject({
  system_id: z.int()
});
const zGetCorporationsCorporationIdStarbasesStarbaseIdResponse = zCorporationsCorporationIdStarbasesStarbaseIdGet;
const zGetCorporationsCorporationIdStructuresHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdStructuresPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdStructuresQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdStructuresResponse = zCorporationsCorporationIdStructuresGet;
const zGetCorporationsStructuresSkyhooksListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsStructuresSkyhooksListingPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsStructuresSkyhooksListingResponse = zCorporationsStructuresSkyhooksListing;
const zGetCorporationsStructuresSkyhooksDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsStructuresSkyhooksDetailPath = z.looseObject({
  skyhook_id: zItemId,
  corporation_id: zCorporationId
});
const zGetCorporationsStructuresSkyhooksDetailResponse = zCorporationsStructuresSkyhooksDetail;
const zGetCorporationsStructuresSovereigntyHubsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsStructuresSovereigntyHubsListingPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsStructuresSovereigntyHubsListingResponse = zCorporationsStructuresSovereigntyHubsListing;
const zGetCorporationsStructuresSovereigntyHubsDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsStructuresSovereigntyHubsDetailPath = z.looseObject({
  sovereignty_hub_id: zItemId,
  corporation_id: zCorporationId
});
const zGetCorporationsStructuresSovereigntyHubsDetailResponse = zCorporationsStructuresSovereigntyHubsDetail;
const zGetCorporationsCorporationIdTitlesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdTitlesPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdTitlesResponse = zCorporationsCorporationIdTitlesGet;
const zGetCorporationsCorporationIdWalletsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdWalletsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetCorporationsCorporationIdWalletsResponse = zCorporationsCorporationIdWalletsGet;
const zGetCorporationsCorporationIdWalletsDivisionJournalHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdWalletsDivisionJournalPath = z.looseObject({
  corporation_id: zCorporationId,
  division: z.int()
});
const zGetCorporationsCorporationIdWalletsDivisionJournalQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetCorporationsCorporationIdWalletsDivisionJournalResponse = zCorporationsCorporationIdWalletsDivisionJournalGet;
const zGetCorporationsCorporationIdWalletsDivisionTransactionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCorporationsCorporationIdWalletsDivisionTransactionsPath = z.looseObject({
  corporation_id: zCorporationId,
  division: z.int()
});
const zGetCorporationsCorporationIdWalletsDivisionTransactionsQuery = z.looseObject({
  from_id: z.int().optional()
});
const zGetCorporationsCorporationIdWalletsDivisionTransactionsResponse = zCorporationsCorporationIdWalletsDivisionTransactionsGet;
const zGetCosmeticsSkinrHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetCosmeticsSkinrPath = z.looseObject({
  skinr_id: z.string()
});
const zGetCosmeticsSkinrResponse = zCosmeticsSkinr;
const zGetDogmaAttributesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetDogmaAttributesResponse = zDogmaAttributesGet;
const zGetDogmaAttributesAttributeIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetDogmaAttributesAttributeIdPath = z.looseObject({
  attribute_id: z.int()
});
const zGetDogmaAttributesAttributeIdResponse = zDogmaAttributesAttributeIdGet;
const zGetDogmaDynamicItemsTypeIdItemIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetDogmaDynamicItemsTypeIdItemIdPath = z.looseObject({
  item_id: z.int(),
  type_id: z.int()
});
const zGetDogmaDynamicItemsTypeIdItemIdResponse = zDogmaDynamicItemsTypeIdItemIdGet;
const zGetDogmaEffectsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetDogmaEffectsResponse = zDogmaEffectsGet;
const zGetDogmaEffectsEffectIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetDogmaEffectsEffectIdPath = z.looseObject({
  effect_id: z.int()
});
const zGetDogmaEffectsEffectIdResponse = zDogmaEffectsEffectIdGet;
const zGetFleetsFleetIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFleetsFleetIdPath = z.looseObject({
  fleet_id: z.int()
});
const zGetFleetsFleetIdResponse = zFleetsFleetIdGet;
const zPutFleetsFleetIdBody = z.looseObject({
  is_free_move: z.boolean().optional(),
  motd: z.string().optional()
});
const zPutFleetsFleetIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutFleetsFleetIdPath = z.looseObject({
  fleet_id: z.int()
});
const zPutFleetsFleetIdResponse = z.undefined();
const zGetFleetsFleetIdMembersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFleetsFleetIdMembersPath = z.looseObject({
  fleet_id: z.int()
});
const zGetFleetsFleetIdMembersResponse = zFleetsFleetIdMembersGet;
const zPostFleetsFleetIdMembersBody = z.looseObject({
  character_id: z.int(),
  role: z.enum([
    "fleet_commander",
    "wing_commander",
    "squad_commander",
    "squad_member"
  ]),
  squad_id: z.int().optional(),
  wing_id: z.int().optional()
});
const zPostFleetsFleetIdMembersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostFleetsFleetIdMembersPath = z.looseObject({
  fleet_id: z.int()
});
const zPostFleetsFleetIdMembersResponse = z.undefined();
const zDeleteFleetsFleetIdMembersMemberIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteFleetsFleetIdMembersMemberIdPath = z.looseObject({
  fleet_id: z.int(),
  member_id: z.int()
});
const zDeleteFleetsFleetIdMembersMemberIdResponse = z.undefined();
const zPutFleetsFleetIdMembersMemberIdBody = z.looseObject({
  role: z.enum([
    "fleet_commander",
    "wing_commander",
    "squad_commander",
    "squad_member"
  ]),
  squad_id: z.int().optional(),
  wing_id: z.int().optional()
});
const zPutFleetsFleetIdMembersMemberIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutFleetsFleetIdMembersMemberIdPath = z.looseObject({
  fleet_id: z.int(),
  member_id: z.int()
});
const zPutFleetsFleetIdMembersMemberIdResponse = z.undefined();
const zDeleteFleetsFleetIdSquadsSquadIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteFleetsFleetIdSquadsSquadIdPath = z.looseObject({
  fleet_id: z.int(),
  squad_id: z.int()
});
const zDeleteFleetsFleetIdSquadsSquadIdResponse = z.undefined();
const zPutFleetsFleetIdSquadsSquadIdBody = z.looseObject({
  name: z.string().max(10)
});
const zPutFleetsFleetIdSquadsSquadIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutFleetsFleetIdSquadsSquadIdPath = z.looseObject({
  fleet_id: z.int(),
  squad_id: z.int()
});
const zPutFleetsFleetIdSquadsSquadIdResponse = z.undefined();
const zGetFleetsFleetIdWingsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFleetsFleetIdWingsPath = z.looseObject({
  fleet_id: z.int()
});
const zGetFleetsFleetIdWingsResponse = zFleetsFleetIdWingsGet;
const zPostFleetsFleetIdWingsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostFleetsFleetIdWingsPath = z.looseObject({
  fleet_id: z.int()
});
const zPostFleetsFleetIdWingsResponse = zFleetsFleetIdWingsPost;
const zDeleteFleetsFleetIdWingsWingIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zDeleteFleetsFleetIdWingsWingIdPath = z.looseObject({
  fleet_id: z.int(),
  wing_id: z.int()
});
const zDeleteFleetsFleetIdWingsWingIdResponse = z.undefined();
const zPutFleetsFleetIdWingsWingIdBody = z.looseObject({
  name: z.string().max(10)
});
const zPutFleetsFleetIdWingsWingIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPutFleetsFleetIdWingsWingIdPath = z.looseObject({
  fleet_id: z.int(),
  wing_id: z.int()
});
const zPutFleetsFleetIdWingsWingIdResponse = z.undefined();
const zPostFleetsFleetIdWingsWingIdSquadsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostFleetsFleetIdWingsWingIdSquadsPath = z.looseObject({
  fleet_id: z.int(),
  wing_id: z.int()
});
const zPostFleetsFleetIdWingsWingIdSquadsResponse = zFleetsFleetIdWingsWingIdSquadsPost;
const zGetFreelanceJobsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFreelanceJobsListingQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10),
  corporation_id: zCorporationId.optional()
});
const zGetFreelanceJobsListingResponse = zFreelanceJobsListing;
const zGetFreelanceJobsDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFreelanceJobsDetailPath = z.looseObject({
  job_id: zUuid
});
const zGetFreelanceJobsDetailResponse = zFreelanceJobsDetail;
const zGetFwLeaderboardsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFwLeaderboardsResponse = zFwLeaderboardsGet;
const zGetFwLeaderboardsCharactersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFwLeaderboardsCharactersResponse = zFwLeaderboardsCharactersGet;
const zGetFwLeaderboardsCorporationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFwLeaderboardsCorporationsResponse = zFwLeaderboardsCorporationsGet;
const zGetFwStatsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFwStatsResponse = zFwStatsGet;
const zGetFwSystemsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFwSystemsResponse = zFwSystemsGet;
const zGetFwWarsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetFwWarsResponse = zFwWarsGet;
const zGetIncursionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetIncursionsResponse = zIncursionsGet;
const zGetIndustryFacilitiesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetIndustryFacilitiesResponse = zIndustryFacilitiesGet;
const zGetIndustrySystemsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetIndustrySystemsResponse = zIndustrySystemsGet;
const zGetInsurancePricesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetInsurancePricesResponse = zInsurancePricesGet;
const zGetKillmailsKillmailIdKillmailHashHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetKillmailsKillmailIdKillmailHashPath = z.looseObject({
  killmail_hash: z.string(),
  killmail_id: z.int()
});
const zGetKillmailsKillmailIdKillmailHashResponse = zKillmailsKillmailIdKillmailHashGet;
const zGetLoyaltyStoresCorporationIdOffersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetLoyaltyStoresCorporationIdOffersPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetLoyaltyStoresCorporationIdOffersResponse = zLoyaltyStoresCorporationIdOffersGet;
const zGetMarketsGroupsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsGroupsResponse = zMarketsGroupsGet;
const zGetMarketsGroupsMarketGroupIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsGroupsMarketGroupIdPath = z.looseObject({
  market_group_id: z.int()
});
const zGetMarketsGroupsMarketGroupIdResponse = zMarketsGroupsMarketGroupIdGet;
const zGetMarketsPricesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsPricesResponse = zMarketsPricesGet;
const zGetMarketsStructuresStructureIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsStructuresStructureIdPath = z.looseObject({
  structure_id: z.int()
});
const zGetMarketsStructuresStructureIdQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetMarketsStructuresStructureIdResponse = zMarketsStructuresStructureIdGet;
const zGetMarketsRegionIdHistoryHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsRegionIdHistoryPath = z.looseObject({
  region_id: z.int()
});
const zGetMarketsRegionIdHistoryQuery = z.looseObject({
  type_id: z.int()
});
const zGetMarketsRegionIdHistoryResponse = zMarketsRegionIdHistoryGet;
const zGetMarketsRegionIdOrdersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsRegionIdOrdersPath = z.looseObject({
  region_id: z.int()
});
const zGetMarketsRegionIdOrdersQuery = z.looseObject({
  order_type: z.enum([
    "buy",
    "sell",
    "all"
  ]).default("all"),
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional(),
  type_id: z.int().optional()
});
const zGetMarketsRegionIdOrdersResponse = zMarketsRegionIdOrdersGet;
const zGetMarketsRegionIdTypesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMarketsRegionIdTypesPath = z.looseObject({
  region_id: z.int()
});
const zGetMarketsRegionIdTypesQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetMarketsRegionIdTypesResponse = zMarketsRegionIdTypesGet;
const zGetMetaChangelogHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMetaChangelogResponse = zMetaChangelog;
const zGetMetaCompatibilityDatesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMetaCompatibilityDatesResponse = zMetaCompatibilityDates;
const zGetMetaNameHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMetaNameResponse = zMetaName;
const zGetMetaStatusHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMetaStatusResponse = zMetaStatus;
const zGetMilitaryCampaignsListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMilitaryCampaignsListingResponse = zMilitaryCampaignsListing;
const zGetMilitaryCampaignsDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMilitaryCampaignsDetailPath = z.looseObject({
  campaign_id: zUuid
});
const zGetMilitaryCampaignsDetailResponse = zMilitaryCampaignsDetail;
const zGetMilitaryCampaignsObjectivesListingHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMilitaryCampaignsObjectivesListingPath = z.looseObject({
  campaign_id: zUuid
});
const zGetMilitaryCampaignsObjectivesListingQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetMilitaryCampaignsObjectivesListingResponse = zMilitaryCampaignsObjectivesListing;
const zGetMilitaryCampaignsObjectivesDetailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetMilitaryCampaignsObjectivesDetailPath = z.looseObject({
  campaign_id: zUuid,
  objective_id: zUuid
});
const zGetMilitaryCampaignsObjectivesDetailResponse = zMilitaryCampaignsObjectivesDetail;
const zGetParagonHubSkinrHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetParagonHubSkinrQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetParagonHubSkinrResponse = zParagonHubSkinr;
const zGetParagonHubSkinrAlliancesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetParagonHubSkinrAlliancesPath = z.looseObject({
  alliance_id: zAllianceId
});
const zGetParagonHubSkinrAlliancesQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetParagonHubSkinrAlliancesResponse = zParagonHubSkinrAlliances;
const zGetParagonHubSkinrCharactersHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetParagonHubSkinrCharactersPath = z.looseObject({
  character_id: zCharacterId
});
const zGetParagonHubSkinrCharactersQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetParagonHubSkinrCharactersResponse = zParagonHubSkinrCharacters;
const zGetParagonHubSkinrCorporationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetParagonHubSkinrCorporationsPath = z.looseObject({
  corporation_id: zCorporationId
});
const zGetParagonHubSkinrCorporationsQuery = z.looseObject({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.int().gte(10).lte(100).optional().default(10)
});
const zGetParagonHubSkinrCorporationsResponse = zParagonHubSkinrCorporations;
const zPostRouteBody = zRouteRequestBody;
const zPostRouteHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostRoutePath = z.looseObject({
  origin_system_id: zSolarSystemId,
  destination_system_id: zSolarSystemId
});
const zPostRouteResponse = zRoute;
const zGetSkyhooksRaidableHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetSkyhooksRaidableResponse = zSkyhooksRaidable;
const zGetSovereigntyCampaignsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetSovereigntyCampaignsResponse = zSovereigntyCampaignsGet;
const zGetSovereigntySystemsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetSovereigntySystemsResponse = zSovereigntySystems;
const zGetStatusHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetStatusResponse = zStatus;
const zPostUiAutopilotWaypointHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUiAutopilotWaypointQuery = z.looseObject({
  add_to_beginning: z.boolean().default(false),
  clear_other_waypoints: z.boolean().default(false),
  destination_id: z.int()
});
const zPostUiAutopilotWaypointResponse = z.undefined();
const zPostUiOpenwindowContractHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUiOpenwindowContractQuery = z.looseObject({
  contract_id: z.int()
});
const zPostUiOpenwindowContractResponse = z.undefined();
const zPostUiOpenwindowInformationHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUiOpenwindowInformationQuery = z.looseObject({
  target_id: z.int()
});
const zPostUiOpenwindowInformationResponse = z.undefined();
const zPostUiOpenwindowMarketdetailsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUiOpenwindowMarketdetailsQuery = z.looseObject({
  type_id: z.int()
});
const zPostUiOpenwindowMarketdetailsResponse = z.undefined();
const zPostUiOpenwindowNewmailBody = z.looseObject({
  body: z.string().max(1e4),
  recipients: z.array(z.int()).min(1).max(50),
  subject: z.string().max(1e3),
  to_corp_or_alliance_id: z.int().optional(),
  to_mailing_list_id: z.int().optional()
});
const zPostUiOpenwindowNewmailHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUiOpenwindowNewmailResponse = z.undefined();
const zGetUniverseAncestriesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseAncestriesResponse = zUniverseAncestriesGet;
const zGetUniverseAsteroidBeltsAsteroidBeltIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseAsteroidBeltsAsteroidBeltIdPath = z.looseObject({
  asteroid_belt_id: z.int()
});
const zGetUniverseAsteroidBeltsAsteroidBeltIdResponse = zUniverseAsteroidBeltsAsteroidBeltIdGet;
const zGetUniverseBloodlinesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseBloodlinesResponse = zUniverseBloodlinesGet;
const zGetUniverseCategoriesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseCategoriesResponse = zUniverseCategoriesGet;
const zGetUniverseCategoriesCategoryIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseCategoriesCategoryIdPath = z.looseObject({
  category_id: z.int()
});
const zGetUniverseCategoriesCategoryIdResponse = zUniverseCategoriesCategoryIdGet;
const zGetUniverseConstellationsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseConstellationsResponse = zUniverseConstellationsGet;
const zGetUniverseConstellationsConstellationIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseConstellationsConstellationIdPath = z.looseObject({
  constellation_id: z.int()
});
const zGetUniverseConstellationsConstellationIdResponse = zUniverseConstellationsConstellationIdGet;
const zGetUniverseFactionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseFactionsResponse = zUniverseFactionsGet;
const zGetUniverseGraphicsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseGraphicsResponse = zUniverseGraphicsGet;
const zGetUniverseGraphicsGraphicIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseGraphicsGraphicIdPath = z.looseObject({
  graphic_id: z.int()
});
const zGetUniverseGraphicsGraphicIdResponse = zUniverseGraphicsGraphicIdGet;
const zGetUniverseGroupsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseGroupsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetUniverseGroupsResponse = zUniverseGroupsGet;
const zGetUniverseGroupsGroupIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseGroupsGroupIdPath = z.looseObject({
  group_id: z.int()
});
const zGetUniverseGroupsGroupIdResponse = zUniverseGroupsGroupIdGet;
const zPostUniverseIdsBody = z.array(z.string().min(1).max(100)).min(1).max(500).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostUniverseIdsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUniverseIdsResponse = zUniverseIdsPost;
const zGetUniverseMoonsMoonIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseMoonsMoonIdPath = z.looseObject({
  moon_id: z.int()
});
const zGetUniverseMoonsMoonIdResponse = zUniverseMoonsMoonIdGet;
const zPostUniverseNamesBody = z.array(z.int()).min(1).max(1e3).refine((items) => new Set(items.map((value) => JSON.stringify(value, (_key, current) => current === null || typeof current !== "object" || Array.isArray(current) ? current : Object.fromEntries(Object.entries(current).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))))).size === items.length, { message: "Array items must be unique" });
const zPostUniverseNamesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zPostUniverseNamesResponse = zUniverseNamesPost;
const zGetUniversePlanetsPlanetIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniversePlanetsPlanetIdPath = z.looseObject({
  planet_id: z.int()
});
const zGetUniversePlanetsPlanetIdResponse = zUniversePlanetsPlanetIdGet;
const zGetUniverseRacesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseRacesResponse = zUniverseRacesGet;
const zGetUniverseRegionsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseRegionsResponse = zUniverseRegionsGet;
const zGetUniverseRegionsRegionIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseRegionsRegionIdPath = z.looseObject({
  region_id: z.int()
});
const zGetUniverseRegionsRegionIdResponse = zUniverseRegionsRegionIdGet;
const zGetUniverseSchematicsSchematicIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseSchematicsSchematicIdPath = z.looseObject({
  schematic_id: z.int()
});
const zGetUniverseSchematicsSchematicIdResponse = zUniverseSchematicsSchematicIdGet;
const zGetUniverseStargatesStargateIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseStargatesStargateIdPath = z.looseObject({
  stargate_id: z.int()
});
const zGetUniverseStargatesStargateIdResponse = zUniverseStargatesStargateIdGet;
const zGetUniverseStarsStarIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseStarsStarIdPath = z.looseObject({
  star_id: z.int()
});
const zGetUniverseStarsStarIdResponse = zUniverseStarsStarIdGet;
const zGetUniverseStationsStationIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseStationsStationIdPath = z.looseObject({
  station_id: z.int()
});
const zGetUniverseStationsStationIdResponse = zUniverseStationsStationIdGet;
const zGetUniverseStructuresHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseStructuresQuery = z.looseObject({
  filter: z.enum(["market", "manufacturing_basic"]).optional()
});
const zGetUniverseStructuresResponse = zUniverseStructuresGet;
const zGetUniverseStructuresStructureIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseStructuresStructureIdPath = z.looseObject({
  structure_id: z.int()
});
const zGetUniverseStructuresStructureIdResponse = zUniverseStructuresStructureIdGet;
const zGetUniverseSystemJumpsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseSystemJumpsResponse = zUniverseSystemJumpsGet;
const zGetUniverseSystemKillsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseSystemKillsResponse = zUniverseSystemKillsGet;
const zGetUniverseSystemsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseSystemsResponse = zUniverseSystemsGet;
const zGetUniverseSystemsSystemIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseSystemsSystemIdPath = z.looseObject({
  system_id: z.int()
});
const zGetUniverseSystemsSystemIdResponse = zUniverseSystemsSystemIdGet;
const zGetUniverseTypesHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseTypesQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetUniverseTypesResponse = zUniverseTypesGet;
const zGetUniverseTypesTypeIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetUniverseTypesTypeIdPath = z.looseObject({
  type_id: z.int()
});
const zGetUniverseTypesTypeIdResponse = zUniverseTypesTypeIdGet;
const zGetWarsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetWarsQuery = z.looseObject({
  max_war_id: z.int().optional()
});
const zGetWarsResponse = zWarsGet;
const zGetWarsWarIdHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetWarsWarIdPath = z.looseObject({
  war_id: z.int()
});
const zGetWarsWarIdResponse = zWarsWarIdGet;
const zGetWarsWarIdKillmailsHeaders = z.looseObject({
  "If-None-Match": z.string().optional(),
  "X-Tenant": z.string().optional().default("tranquility"),
  "If-Modified-Since": z.string().optional()
});
const zGetWarsWarIdKillmailsPath = z.looseObject({
  war_id: z.int()
});
const zGetWarsWarIdKillmailsQuery = z.looseObject({
  page: z.int().gte(1).max(2147483647, { error: "Invalid value: Expected int32 to be <= 2147483647" }).optional()
});
const zGetWarsWarIdKillmailsResponse = zWarsWarIdKillmailsGet;
export {
  zAcceptLanguage,
  zAccessListId,
  zAllianceDetail,
  zAllianceId,
  zAlliancesAllianceIdContactsGet,
  zAlliancesAllianceIdContactsLabelsGet,
  zAlliancesAllianceIdCorporationsGet,
  zAlliancesAllianceIdIconsGet,
  zAlliancesGet,
  zArchetypeId,
  zAttributeId,
  zBloodlineId,
  zCharacterId,
  zCharactersAccessListsDetail,
  zCharactersAccessListsDetailAllianceentry,
  zCharactersAccessListsDetailCharacterentry,
  zCharactersAccessListsDetailCorporationentry,
  zCharactersAccessListsDetailMembership,
  zCharactersAccessListsListing,
  zCharactersAccessListsListingAccesslist,
  zCharactersAffiliationPost,
  zCharactersCharacterIdAgentsResearchGet,
  zCharactersCharacterIdAssetsGet,
  zCharactersCharacterIdAssetsLocationsPost,
  zCharactersCharacterIdAssetsNamesPost,
  zCharactersCharacterIdAttributesGet,
  zCharactersCharacterIdBlueprintsGet,
  zCharactersCharacterIdCalendarEventIdAttendeesGet,
  zCharactersCharacterIdCalendarEventIdGet,
  zCharactersCharacterIdCalendarGet,
  zCharactersCharacterIdClonesGet,
  zCharactersCharacterIdContactsGet,
  zCharactersCharacterIdContactsLabelsGet,
  zCharactersCharacterIdContactsPost,
  zCharactersCharacterIdContractsContractIdBidsGet,
  zCharactersCharacterIdContractsContractIdItemsGet,
  zCharactersCharacterIdContractsGet,
  zCharactersCharacterIdCorporationhistoryGet,
  zCharactersCharacterIdCspaPost,
  zCharactersCharacterIdFatigueGet,
  zCharactersCharacterIdFittingsGet,
  zCharactersCharacterIdFittingsPost,
  zCharactersCharacterIdFleetGet,
  zCharactersCharacterIdFwStatsGet,
  zCharactersCharacterIdImplantsGet,
  zCharactersCharacterIdIndustryJobsGet,
  zCharactersCharacterIdKillmailsRecentGet,
  zCharactersCharacterIdLocationGet,
  zCharactersCharacterIdLoyaltyPointsGet,
  zCharactersCharacterIdMailGet,
  zCharactersCharacterIdMailLabelsGet,
  zCharactersCharacterIdMailLabelsPost,
  zCharactersCharacterIdMailListsGet,
  zCharactersCharacterIdMailMailIdGet,
  zCharactersCharacterIdMailPost,
  zCharactersCharacterIdMedalsGet,
  zCharactersCharacterIdMiningGet,
  zCharactersCharacterIdNotificationsContactsGet,
  zCharactersCharacterIdNotificationsGet,
  zCharactersCharacterIdOnlineGet,
  zCharactersCharacterIdOrdersGet,
  zCharactersCharacterIdOrdersHistoryGet,
  zCharactersCharacterIdPlanetsGet,
  zCharactersCharacterIdPlanetsPlanetIdGet,
  zCharactersCharacterIdPortraitGet,
  zCharactersCharacterIdRolesGet,
  zCharactersCharacterIdSearchGet,
  zCharactersCharacterIdShipGet,
  zCharactersCharacterIdStandingsGet,
  zCharactersCharacterIdTitlesGet,
  zCharactersCharacterIdWalletGet,
  zCharactersCharacterIdWalletJournalGet,
  zCharactersCharacterIdWalletTransactionsGet,
  zCharactersCosmeticsSkinr,
  zCharactersCosmeticsSkinrComponents,
  zCharactersCosmeticsSkinrComponentsItem,
  zCharactersCosmeticsSkinrItem,
  zCharactersDetail,
  zCharactersFreelanceJobsListing,
  zCharactersFreelanceJobsParticipation,
  zCharactersMercenaryTacticalOperationsDetail,
  zCharactersMercenaryTacticalOperationsListing,
  zCharactersMercenaryTacticalOperationsListingOperation,
  zCharactersMilitaryCampaignsObjectivesListing,
  zCharactersMilitaryCampaignsObjectivesParticipation,
  zCharactersMilitaryCampaignsObjectivesParticipationCharacterobjective,
  zCharactersParagonHubSkinr,
  zCharactersParagonHubSkinrItem,
  zCharactersSkillqueueSkill,
  zCharactersSkills,
  zCharactersSkillsSkill,
  zCharactersStructuresMercenaryDensDetail,
  zCharactersStructuresMercenaryDensDetailEvolution,
  zCharactersStructuresMercenaryDensDetailEvolutionanarchy,
  zCharactersStructuresMercenaryDensDetailEvolutiondevelopment,
  zCharactersStructuresMercenaryDensDetailInfomorphs,
  zCharactersStructuresMercenaryDensDetailReinforcementtimer,
  zCharactersStructuresMercenaryDensDetailSkyhook,
  zCharactersStructuresMercenaryDensListing,
  zCharactersStructuresMercenaryDensListingMercenaryden,
  zCompatibilityDate,
  zCompatibilityDate2,
  zConstellationId,
  zContractsPublicBidsContractIdGet,
  zContractsPublicItemsContractIdGet,
  zContractsPublicRegionIdGet,
  zCorporationCorporationIdMiningExtractionsGet,
  zCorporationCorporationIdMiningObserversGet,
  zCorporationCorporationIdMiningObserversObserverIdGet,
  zCorporationId,
  zCorporationsCorporationIdAlliancehistoryGet,
  zCorporationsCorporationIdAssetsGet,
  zCorporationsCorporationIdAssetsLocationsPost,
  zCorporationsCorporationIdAssetsNamesPost,
  zCorporationsCorporationIdBlueprintsGet,
  zCorporationsCorporationIdContactsGet,
  zCorporationsCorporationIdContactsLabelsGet,
  zCorporationsCorporationIdContainersLogsGet,
  zCorporationsCorporationIdContractsContractIdBidsGet,
  zCorporationsCorporationIdContractsContractIdItemsGet,
  zCorporationsCorporationIdContractsGet,
  zCorporationsCorporationIdCustomsOfficesGet,
  zCorporationsCorporationIdDivisionsGet,
  zCorporationsCorporationIdFacilitiesGet,
  zCorporationsCorporationIdFwStatsGet,
  zCorporationsCorporationIdIconsGet,
  zCorporationsCorporationIdIndustryJobsGet,
  zCorporationsCorporationIdKillmailsRecentGet,
  zCorporationsCorporationIdMedalsGet,
  zCorporationsCorporationIdMedalsIssuedGet,
  zCorporationsCorporationIdMembersGet,
  zCorporationsCorporationIdMembersLimitGet,
  zCorporationsCorporationIdMembersTitlesGet,
  zCorporationsCorporationIdMembertrackingGet,
  zCorporationsCorporationIdOrdersGet,
  zCorporationsCorporationIdOrdersHistoryGet,
  zCorporationsCorporationIdRolesGet,
  zCorporationsCorporationIdRolesHistoryGet,
  zCorporationsCorporationIdShareholdersGet,
  zCorporationsCorporationIdStandingsGet,
  zCorporationsCorporationIdStarbasesGet,
  zCorporationsCorporationIdStarbasesStarbaseIdGet,
  zCorporationsCorporationIdStructuresGet,
  zCorporationsCorporationIdTitlesGet,
  zCorporationsCorporationIdWalletsDivisionJournalGet,
  zCorporationsCorporationIdWalletsDivisionTransactionsGet,
  zCorporationsCorporationIdWalletsGet,
  zCorporationsDetail,
  zCorporationsDetailPalette,
  zCorporationsDetailTaxrates,
  zCorporationsFreelanceJobsListing,
  zCorporationsFreelanceJobsParticipants,
  zCorporationsFreelanceJobsParticipantsParticipant,
  zCorporationsNpccorpsGet,
  zCorporationsProjectsContribution,
  zCorporationsProjectsContributors,
  zCorporationsProjectsContributorsContributor,
  zCorporationsProjectsDetail,
  zCorporationsProjectsDetailConfigurationcapturefwcomplex,
  zCorporationsProjectsDetailConfigurationdamageship,
  zCorporationsProjectsDetailConfigurationdefendfwcomplex,
  zCorporationsProjectsDetailConfigurationdeliveritem,
  zCorporationsProjectsDetailConfigurationdestroynpc,
  zCorporationsProjectsDetailConfigurationdestroyship,
  zCorporationsProjectsDetailConfigurationearnloyaltypoints,
  zCorporationsProjectsDetailConfigurationlostship,
  zCorporationsProjectsDetailConfigurationmanual,
  zCorporationsProjectsDetailConfigurationmanufactureitem,
  zCorporationsProjectsDetailConfigurationmatcherarchetype,
  zCorporationsProjectsDetailConfigurationmatchercorporation,
  zCorporationsProjectsDetailConfigurationmatcherfaction,
  zCorporationsProjectsDetailConfigurationmatchersignature,
  zCorporationsProjectsDetailConfigurationminematerial,
  zCorporationsProjectsDetailConfigurationremoteboostshield,
  zCorporationsProjectsDetailConfigurationremoterepairarmor,
  zCorporationsProjectsDetailConfigurationsalvagewreck,
  zCorporationsProjectsDetailConfigurationscansignature,
  zCorporationsProjectsDetailConfigurationshipinsurance,
  zCorporationsProjectsDetailConfigurationunknown,
  zCorporationsProjectsDetailContribution,
  zCorporationsProjectsDetailCreator,
  zCorporationsProjectsDetailDetails,
  zCorporationsProjectsDetailProgress,
  zCorporationsProjectsDetailProject,
  zCorporationsProjectsDetailReward,
  zCorporationsProjectsListing,
  zCorporationsStructuresSkyhooksDetail,
  zCorporationsStructuresSkyhooksDetailReagent,
  zCorporationsStructuresSkyhooksDetailReinforcementtimer,
  zCorporationsStructuresSkyhooksDetailTheftvulnerability,
  zCorporationsStructuresSkyhooksListing,
  zCorporationsStructuresSkyhooksListingSkyhook,
  zCorporationsStructuresSovereigntyHubsDetail,
  zCorporationsStructuresSovereigntyHubsDetailReagent,
  zCorporationsStructuresSovereigntyHubsDetailReagentbay,
  zCorporationsStructuresSovereigntyHubsDetailResourcepower,
  zCorporationsStructuresSovereigntyHubsDetailResources,
  zCorporationsStructuresSovereigntyHubsDetailResourceworkforce,
  zCorporationsStructuresSovereigntyHubsDetailTransport,
  zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationexport,
  zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationimport,
  zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationsource,
  zCorporationsStructuresSovereigntyHubsDetailTransportstateexport,
  zCorporationsStructuresSovereigntyHubsDetailTransportstateimport,
  zCorporationsStructuresSovereigntyHubsDetailTransportstateimportsource,
  zCorporationsStructuresSovereigntyHubsDetailUpgrade,
  zCorporationsStructuresSovereigntyHubsDetailVulnerabilitywindow,
  zCorporationsStructuresSovereigntyHubsListing,
  zCorporationsStructuresSovereigntyHubsListingSovereigntyhub,
  zCosmeticsSkinr,
  zCosmeticsSkinrLayout,
  zCosmeticsSkinrLayoutslot,
  zCosmeticsSkinrPatternconfiguration,
  zCosmeticsSkinrPatternprojection,
  zCosmeticsSkinrPatterntransform,
  zCosmeticsSkinrSlotnanocoating,
  zCosmeticsSkinrSlotpattern,
  zCosmeticsSkinrTier,
  zCosmeticsSkinrVector3,
  zCosmeticsSkinrVector4,
  zCursor,
  zDeleteCharactersCharacterIdContactsHeaders,
  zDeleteCharactersCharacterIdContactsPath,
  zDeleteCharactersCharacterIdContactsQuery,
  zDeleteCharactersCharacterIdContactsResponse,
  zDeleteCharactersCharacterIdFittingsFittingIdHeaders,
  zDeleteCharactersCharacterIdFittingsFittingIdPath,
  zDeleteCharactersCharacterIdFittingsFittingIdResponse,
  zDeleteCharactersCharacterIdMailLabelsLabelIdHeaders,
  zDeleteCharactersCharacterIdMailLabelsLabelIdPath,
  zDeleteCharactersCharacterIdMailLabelsLabelIdResponse,
  zDeleteCharactersCharacterIdMailMailIdHeaders,
  zDeleteCharactersCharacterIdMailMailIdPath,
  zDeleteCharactersCharacterIdMailMailIdResponse,
  zDeleteFleetsFleetIdMembersMemberIdHeaders,
  zDeleteFleetsFleetIdMembersMemberIdPath,
  zDeleteFleetsFleetIdMembersMemberIdResponse,
  zDeleteFleetsFleetIdSquadsSquadIdHeaders,
  zDeleteFleetsFleetIdSquadsSquadIdPath,
  zDeleteFleetsFleetIdSquadsSquadIdResponse,
  zDeleteFleetsFleetIdWingsWingIdHeaders,
  zDeleteFleetsFleetIdWingsWingIdPath,
  zDeleteFleetsFleetIdWingsWingIdResponse,
  zDogmaAttributesAttributeIdGet,
  zDogmaAttributesGet,
  zDogmaDynamicItemsTypeIdItemIdGet,
  zDogmaEffectsEffectIdGet,
  zDogmaEffectsGet,
  zDungeonId,
  zError,
  zErrorDetail,
  zFactionId,
  zFleetsFleetIdGet,
  zFleetsFleetIdMembersGet,
  zFleetsFleetIdWingsGet,
  zFleetsFleetIdWingsPost,
  zFleetsFleetIdWingsWingIdSquadsPost,
  zFreelanceJobsDetail,
  zFreelanceJobsDetailAccessandvisibility,
  zFreelanceJobsDetailBroadcastlocations,
  zFreelanceJobsDetailConfiguration,
  zFreelanceJobsDetailContribution,
  zFreelanceJobsDetailCreator,
  zFreelanceJobsDetailCreatorcharacter,
  zFreelanceJobsDetailCreatorcorporation,
  zFreelanceJobsDetailDetails,
  zFreelanceJobsDetailFreelancejob,
  zFreelanceJobsDetailParameterboolean,
  zFreelanceJobsDetailParametercorporationitemdelivery,
  zFreelanceJobsDetailParametermatcher,
  zFreelanceJobsDetailParametermatchervalue,
  zFreelanceJobsDetailParameteroptions,
  zFreelanceJobsDetailProgress,
  zFreelanceJobsDetailRestrictions,
  zFreelanceJobsDetailReward,
  zFreelanceJobsListing,
  zFwLeaderboardsCharactersGet,
  zFwLeaderboardsCorporationsGet,
  zFwLeaderboardsGet,
  zFwStatsGet,
  zFwSystemsGet,
  zFwWarsGet,
  zGetAlliancesAllianceIdContactsHeaders,
  zGetAlliancesAllianceIdContactsLabelsHeaders,
  zGetAlliancesAllianceIdContactsLabelsPath,
  zGetAlliancesAllianceIdContactsLabelsResponse,
  zGetAlliancesAllianceIdContactsPath,
  zGetAlliancesAllianceIdContactsQuery,
  zGetAlliancesAllianceIdContactsResponse,
  zGetAlliancesAllianceIdCorporationsHeaders,
  zGetAlliancesAllianceIdCorporationsPath,
  zGetAlliancesAllianceIdCorporationsResponse,
  zGetAlliancesAllianceIdHeaders,
  zGetAlliancesAllianceIdIconsHeaders,
  zGetAlliancesAllianceIdIconsPath,
  zGetAlliancesAllianceIdIconsResponse,
  zGetAlliancesAllianceIdPath,
  zGetAlliancesAllianceIdResponse,
  zGetAlliancesHeaders,
  zGetAlliancesResponse,
  zGetCharactersAccessListsDetailHeaders,
  zGetCharactersAccessListsDetailPath,
  zGetCharactersAccessListsDetailResponse,
  zGetCharactersAccessListsListingHeaders,
  zGetCharactersAccessListsListingPath,
  zGetCharactersAccessListsListingResponse,
  zGetCharactersCharacterIdAgentsResearchHeaders,
  zGetCharactersCharacterIdAgentsResearchPath,
  zGetCharactersCharacterIdAgentsResearchResponse,
  zGetCharactersCharacterIdAssetsHeaders,
  zGetCharactersCharacterIdAssetsPath,
  zGetCharactersCharacterIdAssetsQuery,
  zGetCharactersCharacterIdAssetsResponse,
  zGetCharactersCharacterIdAttributesHeaders,
  zGetCharactersCharacterIdAttributesPath,
  zGetCharactersCharacterIdAttributesResponse,
  zGetCharactersCharacterIdBlueprintsHeaders,
  zGetCharactersCharacterIdBlueprintsPath,
  zGetCharactersCharacterIdBlueprintsQuery,
  zGetCharactersCharacterIdBlueprintsResponse,
  zGetCharactersCharacterIdCalendarEventIdAttendeesHeaders,
  zGetCharactersCharacterIdCalendarEventIdAttendeesPath,
  zGetCharactersCharacterIdCalendarEventIdAttendeesResponse,
  zGetCharactersCharacterIdCalendarEventIdHeaders,
  zGetCharactersCharacterIdCalendarEventIdPath,
  zGetCharactersCharacterIdCalendarEventIdResponse,
  zGetCharactersCharacterIdCalendarHeaders,
  zGetCharactersCharacterIdCalendarPath,
  zGetCharactersCharacterIdCalendarQuery,
  zGetCharactersCharacterIdCalendarResponse,
  zGetCharactersCharacterIdClonesHeaders,
  zGetCharactersCharacterIdClonesPath,
  zGetCharactersCharacterIdClonesResponse,
  zGetCharactersCharacterIdContactsHeaders,
  zGetCharactersCharacterIdContactsLabelsHeaders,
  zGetCharactersCharacterIdContactsLabelsPath,
  zGetCharactersCharacterIdContactsLabelsResponse,
  zGetCharactersCharacterIdContactsPath,
  zGetCharactersCharacterIdContactsQuery,
  zGetCharactersCharacterIdContactsResponse,
  zGetCharactersCharacterIdContractsContractIdBidsHeaders,
  zGetCharactersCharacterIdContractsContractIdBidsPath,
  zGetCharactersCharacterIdContractsContractIdBidsResponse,
  zGetCharactersCharacterIdContractsContractIdItemsHeaders,
  zGetCharactersCharacterIdContractsContractIdItemsPath,
  zGetCharactersCharacterIdContractsContractIdItemsResponse,
  zGetCharactersCharacterIdContractsHeaders,
  zGetCharactersCharacterIdContractsPath,
  zGetCharactersCharacterIdContractsQuery,
  zGetCharactersCharacterIdContractsResponse,
  zGetCharactersCharacterIdCorporationhistoryHeaders,
  zGetCharactersCharacterIdCorporationhistoryPath,
  zGetCharactersCharacterIdCorporationhistoryResponse,
  zGetCharactersCharacterIdFatigueHeaders,
  zGetCharactersCharacterIdFatiguePath,
  zGetCharactersCharacterIdFatigueResponse,
  zGetCharactersCharacterIdFittingsHeaders,
  zGetCharactersCharacterIdFittingsPath,
  zGetCharactersCharacterIdFittingsResponse,
  zGetCharactersCharacterIdFleetHeaders,
  zGetCharactersCharacterIdFleetPath,
  zGetCharactersCharacterIdFleetResponse,
  zGetCharactersCharacterIdFwStatsHeaders,
  zGetCharactersCharacterIdFwStatsPath,
  zGetCharactersCharacterIdFwStatsResponse,
  zGetCharactersCharacterIdImplantsHeaders,
  zGetCharactersCharacterIdImplantsPath,
  zGetCharactersCharacterIdImplantsResponse,
  zGetCharactersCharacterIdIndustryJobsHeaders,
  zGetCharactersCharacterIdIndustryJobsPath,
  zGetCharactersCharacterIdIndustryJobsQuery,
  zGetCharactersCharacterIdIndustryJobsResponse,
  zGetCharactersCharacterIdKillmailsRecentHeaders,
  zGetCharactersCharacterIdKillmailsRecentPath,
  zGetCharactersCharacterIdKillmailsRecentQuery,
  zGetCharactersCharacterIdKillmailsRecentResponse,
  zGetCharactersCharacterIdLocationHeaders,
  zGetCharactersCharacterIdLocationPath,
  zGetCharactersCharacterIdLocationResponse,
  zGetCharactersCharacterIdLoyaltyPointsHeaders,
  zGetCharactersCharacterIdLoyaltyPointsPath,
  zGetCharactersCharacterIdLoyaltyPointsResponse,
  zGetCharactersCharacterIdMailHeaders,
  zGetCharactersCharacterIdMailLabelsHeaders,
  zGetCharactersCharacterIdMailLabelsPath,
  zGetCharactersCharacterIdMailLabelsResponse,
  zGetCharactersCharacterIdMailListsHeaders,
  zGetCharactersCharacterIdMailListsPath,
  zGetCharactersCharacterIdMailListsResponse,
  zGetCharactersCharacterIdMailMailIdHeaders,
  zGetCharactersCharacterIdMailMailIdPath,
  zGetCharactersCharacterIdMailMailIdResponse,
  zGetCharactersCharacterIdMailPath,
  zGetCharactersCharacterIdMailQuery,
  zGetCharactersCharacterIdMailResponse,
  zGetCharactersCharacterIdMedalsHeaders,
  zGetCharactersCharacterIdMedalsPath,
  zGetCharactersCharacterIdMedalsResponse,
  zGetCharactersCharacterIdMiningHeaders,
  zGetCharactersCharacterIdMiningPath,
  zGetCharactersCharacterIdMiningQuery,
  zGetCharactersCharacterIdMiningResponse,
  zGetCharactersCharacterIdNotificationsContactsHeaders,
  zGetCharactersCharacterIdNotificationsContactsPath,
  zGetCharactersCharacterIdNotificationsContactsResponse,
  zGetCharactersCharacterIdNotificationsHeaders,
  zGetCharactersCharacterIdNotificationsPath,
  zGetCharactersCharacterIdNotificationsResponse,
  zGetCharactersCharacterIdOnlineHeaders,
  zGetCharactersCharacterIdOnlinePath,
  zGetCharactersCharacterIdOnlineResponse,
  zGetCharactersCharacterIdOrdersHeaders,
  zGetCharactersCharacterIdOrdersHistoryHeaders,
  zGetCharactersCharacterIdOrdersHistoryPath,
  zGetCharactersCharacterIdOrdersHistoryQuery,
  zGetCharactersCharacterIdOrdersHistoryResponse,
  zGetCharactersCharacterIdOrdersPath,
  zGetCharactersCharacterIdOrdersResponse,
  zGetCharactersCharacterIdPlanetsHeaders,
  zGetCharactersCharacterIdPlanetsPath,
  zGetCharactersCharacterIdPlanetsPlanetIdHeaders,
  zGetCharactersCharacterIdPlanetsPlanetIdPath,
  zGetCharactersCharacterIdPlanetsPlanetIdResponse,
  zGetCharactersCharacterIdPlanetsResponse,
  zGetCharactersCharacterIdPortraitHeaders,
  zGetCharactersCharacterIdPortraitPath,
  zGetCharactersCharacterIdPortraitResponse,
  zGetCharactersCharacterIdRolesHeaders,
  zGetCharactersCharacterIdRolesPath,
  zGetCharactersCharacterIdRolesResponse,
  zGetCharactersCharacterIdSearchHeaders,
  zGetCharactersCharacterIdSearchPath,
  zGetCharactersCharacterIdSearchQuery,
  zGetCharactersCharacterIdSearchResponse,
  zGetCharactersCharacterIdShipHeaders,
  zGetCharactersCharacterIdShipPath,
  zGetCharactersCharacterIdShipResponse,
  zGetCharactersCharacterIdSkillqueueHeaders,
  zGetCharactersCharacterIdSkillqueuePath,
  zGetCharactersCharacterIdSkillqueueResponse,
  zGetCharactersCharacterIdSkillsHeaders,
  zGetCharactersCharacterIdSkillsPath,
  zGetCharactersCharacterIdSkillsResponse,
  zGetCharactersCharacterIdStandingsHeaders,
  zGetCharactersCharacterIdStandingsPath,
  zGetCharactersCharacterIdStandingsResponse,
  zGetCharactersCharacterIdTitlesHeaders,
  zGetCharactersCharacterIdTitlesPath,
  zGetCharactersCharacterIdTitlesResponse,
  zGetCharactersCharacterIdWalletHeaders,
  zGetCharactersCharacterIdWalletJournalHeaders,
  zGetCharactersCharacterIdWalletJournalPath,
  zGetCharactersCharacterIdWalletJournalQuery,
  zGetCharactersCharacterIdWalletJournalResponse,
  zGetCharactersCharacterIdWalletPath,
  zGetCharactersCharacterIdWalletResponse,
  zGetCharactersCharacterIdWalletTransactionsHeaders,
  zGetCharactersCharacterIdWalletTransactionsPath,
  zGetCharactersCharacterIdWalletTransactionsQuery,
  zGetCharactersCharacterIdWalletTransactionsResponse,
  zGetCharactersCosmeticsSkinrComponentsHeaders,
  zGetCharactersCosmeticsSkinrComponentsPath,
  zGetCharactersCosmeticsSkinrComponentsResponse,
  zGetCharactersCosmeticsSkinrHeaders,
  zGetCharactersCosmeticsSkinrPath,
  zGetCharactersCosmeticsSkinrResponse,
  zGetCharactersDetailHeaders,
  zGetCharactersDetailPath,
  zGetCharactersDetailResponse,
  zGetCharactersFreelanceJobsListingHeaders,
  zGetCharactersFreelanceJobsListingPath,
  zGetCharactersFreelanceJobsListingResponse,
  zGetCharactersFreelanceJobsParticipationHeaders,
  zGetCharactersFreelanceJobsParticipationPath,
  zGetCharactersFreelanceJobsParticipationResponse,
  zGetCharactersMercenaryTacticalOperationsDetailHeaders,
  zGetCharactersMercenaryTacticalOperationsDetailPath,
  zGetCharactersMercenaryTacticalOperationsDetailResponse,
  zGetCharactersMercenaryTacticalOperationsListingHeaders,
  zGetCharactersMercenaryTacticalOperationsListingPath,
  zGetCharactersMercenaryTacticalOperationsListingResponse,
  zGetCharactersMilitaryCampaignsObjectivesListingHeaders,
  zGetCharactersMilitaryCampaignsObjectivesListingPath,
  zGetCharactersMilitaryCampaignsObjectivesListingQuery,
  zGetCharactersMilitaryCampaignsObjectivesListingResponse,
  zGetCharactersMilitaryCampaignsObjectivesParticipationHeaders,
  zGetCharactersMilitaryCampaignsObjectivesParticipationPath,
  zGetCharactersMilitaryCampaignsObjectivesParticipationResponse,
  zGetCharactersParagonHubSkinrHeaders,
  zGetCharactersParagonHubSkinrPath,
  zGetCharactersParagonHubSkinrQuery,
  zGetCharactersParagonHubSkinrResponse,
  zGetCharactersStructuresMercenaryDensDetailHeaders,
  zGetCharactersStructuresMercenaryDensDetailPath,
  zGetCharactersStructuresMercenaryDensDetailResponse,
  zGetCharactersStructuresMercenaryDensListingHeaders,
  zGetCharactersStructuresMercenaryDensListingPath,
  zGetCharactersStructuresMercenaryDensListingResponse,
  zGetContractsPublicBidsContractIdHeaders,
  zGetContractsPublicBidsContractIdPath,
  zGetContractsPublicBidsContractIdQuery,
  zGetContractsPublicBidsContractIdResponse,
  zGetContractsPublicItemsContractIdHeaders,
  zGetContractsPublicItemsContractIdPath,
  zGetContractsPublicItemsContractIdQuery,
  zGetContractsPublicItemsContractIdResponse,
  zGetContractsPublicRegionIdHeaders,
  zGetContractsPublicRegionIdPath,
  zGetContractsPublicRegionIdQuery,
  zGetContractsPublicRegionIdResponse,
  zGetCorporationCorporationIdMiningExtractionsHeaders,
  zGetCorporationCorporationIdMiningExtractionsPath,
  zGetCorporationCorporationIdMiningExtractionsQuery,
  zGetCorporationCorporationIdMiningExtractionsResponse,
  zGetCorporationCorporationIdMiningObserversHeaders,
  zGetCorporationCorporationIdMiningObserversObserverIdHeaders,
  zGetCorporationCorporationIdMiningObserversObserverIdPath,
  zGetCorporationCorporationIdMiningObserversObserverIdQuery,
  zGetCorporationCorporationIdMiningObserversObserverIdResponse,
  zGetCorporationCorporationIdMiningObserversPath,
  zGetCorporationCorporationIdMiningObserversQuery,
  zGetCorporationCorporationIdMiningObserversResponse,
  zGetCorporationsCorporationIdAlliancehistoryHeaders,
  zGetCorporationsCorporationIdAlliancehistoryPath,
  zGetCorporationsCorporationIdAlliancehistoryResponse,
  zGetCorporationsCorporationIdAssetsHeaders,
  zGetCorporationsCorporationIdAssetsPath,
  zGetCorporationsCorporationIdAssetsQuery,
  zGetCorporationsCorporationIdAssetsResponse,
  zGetCorporationsCorporationIdBlueprintsHeaders,
  zGetCorporationsCorporationIdBlueprintsPath,
  zGetCorporationsCorporationIdBlueprintsQuery,
  zGetCorporationsCorporationIdBlueprintsResponse,
  zGetCorporationsCorporationIdContactsHeaders,
  zGetCorporationsCorporationIdContactsLabelsHeaders,
  zGetCorporationsCorporationIdContactsLabelsPath,
  zGetCorporationsCorporationIdContactsLabelsResponse,
  zGetCorporationsCorporationIdContactsPath,
  zGetCorporationsCorporationIdContactsQuery,
  zGetCorporationsCorporationIdContactsResponse,
  zGetCorporationsCorporationIdContainersLogsHeaders,
  zGetCorporationsCorporationIdContainersLogsPath,
  zGetCorporationsCorporationIdContainersLogsQuery,
  zGetCorporationsCorporationIdContainersLogsResponse,
  zGetCorporationsCorporationIdContractsContractIdBidsHeaders,
  zGetCorporationsCorporationIdContractsContractIdBidsPath,
  zGetCorporationsCorporationIdContractsContractIdBidsQuery,
  zGetCorporationsCorporationIdContractsContractIdBidsResponse,
  zGetCorporationsCorporationIdContractsContractIdItemsHeaders,
  zGetCorporationsCorporationIdContractsContractIdItemsPath,
  zGetCorporationsCorporationIdContractsContractIdItemsResponse,
  zGetCorporationsCorporationIdContractsHeaders,
  zGetCorporationsCorporationIdContractsPath,
  zGetCorporationsCorporationIdContractsQuery,
  zGetCorporationsCorporationIdContractsResponse,
  zGetCorporationsCorporationIdCustomsOfficesHeaders,
  zGetCorporationsCorporationIdCustomsOfficesPath,
  zGetCorporationsCorporationIdCustomsOfficesQuery,
  zGetCorporationsCorporationIdCustomsOfficesResponse,
  zGetCorporationsCorporationIdDivisionsHeaders,
  zGetCorporationsCorporationIdDivisionsPath,
  zGetCorporationsCorporationIdDivisionsResponse,
  zGetCorporationsCorporationIdFacilitiesHeaders,
  zGetCorporationsCorporationIdFacilitiesPath,
  zGetCorporationsCorporationIdFacilitiesResponse,
  zGetCorporationsCorporationIdFwStatsHeaders,
  zGetCorporationsCorporationIdFwStatsPath,
  zGetCorporationsCorporationIdFwStatsResponse,
  zGetCorporationsCorporationIdHeaders,
  zGetCorporationsCorporationIdIconsHeaders,
  zGetCorporationsCorporationIdIconsPath,
  zGetCorporationsCorporationIdIconsResponse,
  zGetCorporationsCorporationIdIndustryJobsHeaders,
  zGetCorporationsCorporationIdIndustryJobsPath,
  zGetCorporationsCorporationIdIndustryJobsQuery,
  zGetCorporationsCorporationIdIndustryJobsResponse,
  zGetCorporationsCorporationIdKillmailsRecentHeaders,
  zGetCorporationsCorporationIdKillmailsRecentPath,
  zGetCorporationsCorporationIdKillmailsRecentQuery,
  zGetCorporationsCorporationIdKillmailsRecentResponse,
  zGetCorporationsCorporationIdMedalsHeaders,
  zGetCorporationsCorporationIdMedalsIssuedHeaders,
  zGetCorporationsCorporationIdMedalsIssuedPath,
  zGetCorporationsCorporationIdMedalsIssuedQuery,
  zGetCorporationsCorporationIdMedalsIssuedResponse,
  zGetCorporationsCorporationIdMedalsPath,
  zGetCorporationsCorporationIdMedalsQuery,
  zGetCorporationsCorporationIdMedalsResponse,
  zGetCorporationsCorporationIdMembersHeaders,
  zGetCorporationsCorporationIdMembersLimitHeaders,
  zGetCorporationsCorporationIdMembersLimitPath,
  zGetCorporationsCorporationIdMembersLimitResponse,
  zGetCorporationsCorporationIdMembersPath,
  zGetCorporationsCorporationIdMembersResponse,
  zGetCorporationsCorporationIdMembersTitlesHeaders,
  zGetCorporationsCorporationIdMembersTitlesPath,
  zGetCorporationsCorporationIdMembersTitlesResponse,
  zGetCorporationsCorporationIdMembertrackingHeaders,
  zGetCorporationsCorporationIdMembertrackingPath,
  zGetCorporationsCorporationIdMembertrackingResponse,
  zGetCorporationsCorporationIdOrdersHeaders,
  zGetCorporationsCorporationIdOrdersHistoryHeaders,
  zGetCorporationsCorporationIdOrdersHistoryPath,
  zGetCorporationsCorporationIdOrdersHistoryQuery,
  zGetCorporationsCorporationIdOrdersHistoryResponse,
  zGetCorporationsCorporationIdOrdersPath,
  zGetCorporationsCorporationIdOrdersQuery,
  zGetCorporationsCorporationIdOrdersResponse,
  zGetCorporationsCorporationIdPath,
  zGetCorporationsCorporationIdResponse,
  zGetCorporationsCorporationIdRolesHeaders,
  zGetCorporationsCorporationIdRolesHistoryHeaders,
  zGetCorporationsCorporationIdRolesHistoryPath,
  zGetCorporationsCorporationIdRolesHistoryQuery,
  zGetCorporationsCorporationIdRolesHistoryResponse,
  zGetCorporationsCorporationIdRolesPath,
  zGetCorporationsCorporationIdRolesResponse,
  zGetCorporationsCorporationIdShareholdersHeaders,
  zGetCorporationsCorporationIdShareholdersPath,
  zGetCorporationsCorporationIdShareholdersQuery,
  zGetCorporationsCorporationIdShareholdersResponse,
  zGetCorporationsCorporationIdStandingsHeaders,
  zGetCorporationsCorporationIdStandingsPath,
  zGetCorporationsCorporationIdStandingsQuery,
  zGetCorporationsCorporationIdStandingsResponse,
  zGetCorporationsCorporationIdStarbasesHeaders,
  zGetCorporationsCorporationIdStarbasesPath,
  zGetCorporationsCorporationIdStarbasesQuery,
  zGetCorporationsCorporationIdStarbasesResponse,
  zGetCorporationsCorporationIdStarbasesStarbaseIdHeaders,
  zGetCorporationsCorporationIdStarbasesStarbaseIdPath,
  zGetCorporationsCorporationIdStarbasesStarbaseIdQuery,
  zGetCorporationsCorporationIdStarbasesStarbaseIdResponse,
  zGetCorporationsCorporationIdStructuresHeaders,
  zGetCorporationsCorporationIdStructuresPath,
  zGetCorporationsCorporationIdStructuresQuery,
  zGetCorporationsCorporationIdStructuresResponse,
  zGetCorporationsCorporationIdTitlesHeaders,
  zGetCorporationsCorporationIdTitlesPath,
  zGetCorporationsCorporationIdTitlesResponse,
  zGetCorporationsCorporationIdWalletsDivisionJournalHeaders,
  zGetCorporationsCorporationIdWalletsDivisionJournalPath,
  zGetCorporationsCorporationIdWalletsDivisionJournalQuery,
  zGetCorporationsCorporationIdWalletsDivisionJournalResponse,
  zGetCorporationsCorporationIdWalletsDivisionTransactionsHeaders,
  zGetCorporationsCorporationIdWalletsDivisionTransactionsPath,
  zGetCorporationsCorporationIdWalletsDivisionTransactionsQuery,
  zGetCorporationsCorporationIdWalletsDivisionTransactionsResponse,
  zGetCorporationsCorporationIdWalletsHeaders,
  zGetCorporationsCorporationIdWalletsPath,
  zGetCorporationsCorporationIdWalletsResponse,
  zGetCorporationsFreelanceJobsListingHeaders,
  zGetCorporationsFreelanceJobsListingPath,
  zGetCorporationsFreelanceJobsListingQuery,
  zGetCorporationsFreelanceJobsListingResponse,
  zGetCorporationsFreelanceJobsParticipantsHeaders,
  zGetCorporationsFreelanceJobsParticipantsPath,
  zGetCorporationsFreelanceJobsParticipantsQuery,
  zGetCorporationsFreelanceJobsParticipantsResponse,
  zGetCorporationsNpccorpsHeaders,
  zGetCorporationsNpccorpsResponse,
  zGetCorporationsProjectsContributionHeaders,
  zGetCorporationsProjectsContributionPath,
  zGetCorporationsProjectsContributionResponse,
  zGetCorporationsProjectsContributorsHeaders,
  zGetCorporationsProjectsContributorsPath,
  zGetCorporationsProjectsContributorsQuery,
  zGetCorporationsProjectsContributorsResponse,
  zGetCorporationsProjectsDetailHeaders,
  zGetCorporationsProjectsDetailPath,
  zGetCorporationsProjectsDetailResponse,
  zGetCorporationsProjectsListingHeaders,
  zGetCorporationsProjectsListingPath,
  zGetCorporationsProjectsListingQuery,
  zGetCorporationsProjectsListingResponse,
  zGetCorporationsStructuresSkyhooksDetailHeaders,
  zGetCorporationsStructuresSkyhooksDetailPath,
  zGetCorporationsStructuresSkyhooksDetailResponse,
  zGetCorporationsStructuresSkyhooksListingHeaders,
  zGetCorporationsStructuresSkyhooksListingPath,
  zGetCorporationsStructuresSkyhooksListingResponse,
  zGetCorporationsStructuresSovereigntyHubsDetailHeaders,
  zGetCorporationsStructuresSovereigntyHubsDetailPath,
  zGetCorporationsStructuresSovereigntyHubsDetailResponse,
  zGetCorporationsStructuresSovereigntyHubsListingHeaders,
  zGetCorporationsStructuresSovereigntyHubsListingPath,
  zGetCorporationsStructuresSovereigntyHubsListingResponse,
  zGetCosmeticsSkinrHeaders,
  zGetCosmeticsSkinrPath,
  zGetCosmeticsSkinrResponse,
  zGetDogmaAttributesAttributeIdHeaders,
  zGetDogmaAttributesAttributeIdPath,
  zGetDogmaAttributesAttributeIdResponse,
  zGetDogmaAttributesHeaders,
  zGetDogmaAttributesResponse,
  zGetDogmaDynamicItemsTypeIdItemIdHeaders,
  zGetDogmaDynamicItemsTypeIdItemIdPath,
  zGetDogmaDynamicItemsTypeIdItemIdResponse,
  zGetDogmaEffectsEffectIdHeaders,
  zGetDogmaEffectsEffectIdPath,
  zGetDogmaEffectsEffectIdResponse,
  zGetDogmaEffectsHeaders,
  zGetDogmaEffectsResponse,
  zGetFleetsFleetIdHeaders,
  zGetFleetsFleetIdMembersHeaders,
  zGetFleetsFleetIdMembersPath,
  zGetFleetsFleetIdMembersResponse,
  zGetFleetsFleetIdPath,
  zGetFleetsFleetIdResponse,
  zGetFleetsFleetIdWingsHeaders,
  zGetFleetsFleetIdWingsPath,
  zGetFleetsFleetIdWingsResponse,
  zGetFreelanceJobsDetailHeaders,
  zGetFreelanceJobsDetailPath,
  zGetFreelanceJobsDetailResponse,
  zGetFreelanceJobsListingHeaders,
  zGetFreelanceJobsListingQuery,
  zGetFreelanceJobsListingResponse,
  zGetFwLeaderboardsCharactersHeaders,
  zGetFwLeaderboardsCharactersResponse,
  zGetFwLeaderboardsCorporationsHeaders,
  zGetFwLeaderboardsCorporationsResponse,
  zGetFwLeaderboardsHeaders,
  zGetFwLeaderboardsResponse,
  zGetFwStatsHeaders,
  zGetFwStatsResponse,
  zGetFwSystemsHeaders,
  zGetFwSystemsResponse,
  zGetFwWarsHeaders,
  zGetFwWarsResponse,
  zGetIncursionsHeaders,
  zGetIncursionsResponse,
  zGetIndustryFacilitiesHeaders,
  zGetIndustryFacilitiesResponse,
  zGetIndustrySystemsHeaders,
  zGetIndustrySystemsResponse,
  zGetInsurancePricesHeaders,
  zGetInsurancePricesResponse,
  zGetKillmailsKillmailIdKillmailHashHeaders,
  zGetKillmailsKillmailIdKillmailHashPath,
  zGetKillmailsKillmailIdKillmailHashResponse,
  zGetLoyaltyStoresCorporationIdOffersHeaders,
  zGetLoyaltyStoresCorporationIdOffersPath,
  zGetLoyaltyStoresCorporationIdOffersResponse,
  zGetMarketsGroupsHeaders,
  zGetMarketsGroupsMarketGroupIdHeaders,
  zGetMarketsGroupsMarketGroupIdPath,
  zGetMarketsGroupsMarketGroupIdResponse,
  zGetMarketsGroupsResponse,
  zGetMarketsPricesHeaders,
  zGetMarketsPricesResponse,
  zGetMarketsRegionIdHistoryHeaders,
  zGetMarketsRegionIdHistoryPath,
  zGetMarketsRegionIdHistoryQuery,
  zGetMarketsRegionIdHistoryResponse,
  zGetMarketsRegionIdOrdersHeaders,
  zGetMarketsRegionIdOrdersPath,
  zGetMarketsRegionIdOrdersQuery,
  zGetMarketsRegionIdOrdersResponse,
  zGetMarketsRegionIdTypesHeaders,
  zGetMarketsRegionIdTypesPath,
  zGetMarketsRegionIdTypesQuery,
  zGetMarketsRegionIdTypesResponse,
  zGetMarketsStructuresStructureIdHeaders,
  zGetMarketsStructuresStructureIdPath,
  zGetMarketsStructuresStructureIdQuery,
  zGetMarketsStructuresStructureIdResponse,
  zGetMetaChangelogHeaders,
  zGetMetaChangelogResponse,
  zGetMetaCompatibilityDatesHeaders,
  zGetMetaCompatibilityDatesResponse,
  zGetMetaNameHeaders,
  zGetMetaNameResponse,
  zGetMetaStatusHeaders,
  zGetMetaStatusResponse,
  zGetMilitaryCampaignsDetailHeaders,
  zGetMilitaryCampaignsDetailPath,
  zGetMilitaryCampaignsDetailResponse,
  zGetMilitaryCampaignsListingHeaders,
  zGetMilitaryCampaignsListingResponse,
  zGetMilitaryCampaignsObjectivesDetailHeaders,
  zGetMilitaryCampaignsObjectivesDetailPath,
  zGetMilitaryCampaignsObjectivesDetailResponse,
  zGetMilitaryCampaignsObjectivesListingHeaders,
  zGetMilitaryCampaignsObjectivesListingPath,
  zGetMilitaryCampaignsObjectivesListingQuery,
  zGetMilitaryCampaignsObjectivesListingResponse,
  zGetParagonHubSkinrAlliancesHeaders,
  zGetParagonHubSkinrAlliancesPath,
  zGetParagonHubSkinrAlliancesQuery,
  zGetParagonHubSkinrAlliancesResponse,
  zGetParagonHubSkinrCharactersHeaders,
  zGetParagonHubSkinrCharactersPath,
  zGetParagonHubSkinrCharactersQuery,
  zGetParagonHubSkinrCharactersResponse,
  zGetParagonHubSkinrCorporationsHeaders,
  zGetParagonHubSkinrCorporationsPath,
  zGetParagonHubSkinrCorporationsQuery,
  zGetParagonHubSkinrCorporationsResponse,
  zGetParagonHubSkinrHeaders,
  zGetParagonHubSkinrQuery,
  zGetParagonHubSkinrResponse,
  zGetSkyhooksRaidableHeaders,
  zGetSkyhooksRaidableResponse,
  zGetSovereigntyCampaignsHeaders,
  zGetSovereigntyCampaignsResponse,
  zGetSovereigntySystemsHeaders,
  zGetSovereigntySystemsResponse,
  zGetStatusHeaders,
  zGetStatusResponse,
  zGetUniverseAncestriesHeaders,
  zGetUniverseAncestriesResponse,
  zGetUniverseAsteroidBeltsAsteroidBeltIdHeaders,
  zGetUniverseAsteroidBeltsAsteroidBeltIdPath,
  zGetUniverseAsteroidBeltsAsteroidBeltIdResponse,
  zGetUniverseBloodlinesHeaders,
  zGetUniverseBloodlinesResponse,
  zGetUniverseCategoriesCategoryIdHeaders,
  zGetUniverseCategoriesCategoryIdPath,
  zGetUniverseCategoriesCategoryIdResponse,
  zGetUniverseCategoriesHeaders,
  zGetUniverseCategoriesResponse,
  zGetUniverseConstellationsConstellationIdHeaders,
  zGetUniverseConstellationsConstellationIdPath,
  zGetUniverseConstellationsConstellationIdResponse,
  zGetUniverseConstellationsHeaders,
  zGetUniverseConstellationsResponse,
  zGetUniverseFactionsHeaders,
  zGetUniverseFactionsResponse,
  zGetUniverseGraphicsGraphicIdHeaders,
  zGetUniverseGraphicsGraphicIdPath,
  zGetUniverseGraphicsGraphicIdResponse,
  zGetUniverseGraphicsHeaders,
  zGetUniverseGraphicsResponse,
  zGetUniverseGroupsGroupIdHeaders,
  zGetUniverseGroupsGroupIdPath,
  zGetUniverseGroupsGroupIdResponse,
  zGetUniverseGroupsHeaders,
  zGetUniverseGroupsQuery,
  zGetUniverseGroupsResponse,
  zGetUniverseMoonsMoonIdHeaders,
  zGetUniverseMoonsMoonIdPath,
  zGetUniverseMoonsMoonIdResponse,
  zGetUniversePlanetsPlanetIdHeaders,
  zGetUniversePlanetsPlanetIdPath,
  zGetUniversePlanetsPlanetIdResponse,
  zGetUniverseRacesHeaders,
  zGetUniverseRacesResponse,
  zGetUniverseRegionsHeaders,
  zGetUniverseRegionsRegionIdHeaders,
  zGetUniverseRegionsRegionIdPath,
  zGetUniverseRegionsRegionIdResponse,
  zGetUniverseRegionsResponse,
  zGetUniverseSchematicsSchematicIdHeaders,
  zGetUniverseSchematicsSchematicIdPath,
  zGetUniverseSchematicsSchematicIdResponse,
  zGetUniverseStargatesStargateIdHeaders,
  zGetUniverseStargatesStargateIdPath,
  zGetUniverseStargatesStargateIdResponse,
  zGetUniverseStarsStarIdHeaders,
  zGetUniverseStarsStarIdPath,
  zGetUniverseStarsStarIdResponse,
  zGetUniverseStationsStationIdHeaders,
  zGetUniverseStationsStationIdPath,
  zGetUniverseStationsStationIdResponse,
  zGetUniverseStructuresHeaders,
  zGetUniverseStructuresQuery,
  zGetUniverseStructuresResponse,
  zGetUniverseStructuresStructureIdHeaders,
  zGetUniverseStructuresStructureIdPath,
  zGetUniverseStructuresStructureIdResponse,
  zGetUniverseSystemJumpsHeaders,
  zGetUniverseSystemJumpsResponse,
  zGetUniverseSystemKillsHeaders,
  zGetUniverseSystemKillsResponse,
  zGetUniverseSystemsHeaders,
  zGetUniverseSystemsResponse,
  zGetUniverseSystemsSystemIdHeaders,
  zGetUniverseSystemsSystemIdPath,
  zGetUniverseSystemsSystemIdResponse,
  zGetUniverseTypesHeaders,
  zGetUniverseTypesQuery,
  zGetUniverseTypesResponse,
  zGetUniverseTypesTypeIdHeaders,
  zGetUniverseTypesTypeIdPath,
  zGetUniverseTypesTypeIdResponse,
  zGetWarsHeaders,
  zGetWarsQuery,
  zGetWarsResponse,
  zGetWarsWarIdHeaders,
  zGetWarsWarIdKillmailsHeaders,
  zGetWarsWarIdKillmailsPath,
  zGetWarsWarIdKillmailsQuery,
  zGetWarsWarIdKillmailsResponse,
  zGetWarsWarIdPath,
  zGetWarsWarIdResponse,
  zGroupId,
  zIfModifiedSince,
  zIfNoneMatch,
  zIncursionsGet,
  zIndustryFacilitiesGet,
  zIndustrySystemsGet,
  zInsurancePricesGet,
  zItemId,
  zKillmailsKillmailIdKillmailHashGet,
  zLoyaltyStoresCorporationIdOffersGet,
  zMarketsGroupsGet,
  zMarketsGroupsMarketGroupIdGet,
  zMarketsPricesGet,
  zMarketsRegionIdHistoryGet,
  zMarketsRegionIdOrdersGet,
  zMarketsRegionIdTypesGet,
  zMarketsStructuresStructureIdGet,
  zMetaChangelog,
  zMetaChangelogEntry,
  zMetaCompatibilityDates,
  zMetaName,
  zMetaNameEntry,
  zMetaStatus,
  zMetaStatusRoutestatus,
  zMilitaryCampaignsDetail,
  zMilitaryCampaignsDetailCampaign,
  zMilitaryCampaignsListing,
  zMilitaryCampaignsObjectivesDetail,
  zMilitaryCampaignsObjectivesDetailObjective,
  zMilitaryCampaignsObjectivesDetailParticipants,
  zMilitaryCampaignsObjectivesListing,
  zParagonHubSkinr,
  zParagonHubSkinrAlliances,
  zParagonHubSkinrCharacters,
  zParagonHubSkinrCorporations,
  zParagonHubSkinrInternalItem,
  zPlanetId,
  zPostCharactersAffiliationBody,
  zPostCharactersAffiliationHeaders,
  zPostCharactersAffiliationResponse,
  zPostCharactersCharacterIdAssetsLocationsBody,
  zPostCharactersCharacterIdAssetsLocationsHeaders,
  zPostCharactersCharacterIdAssetsLocationsPath,
  zPostCharactersCharacterIdAssetsLocationsResponse,
  zPostCharactersCharacterIdAssetsNamesBody,
  zPostCharactersCharacterIdAssetsNamesHeaders,
  zPostCharactersCharacterIdAssetsNamesPath,
  zPostCharactersCharacterIdAssetsNamesResponse,
  zPostCharactersCharacterIdContactsBody,
  zPostCharactersCharacterIdContactsHeaders,
  zPostCharactersCharacterIdContactsPath,
  zPostCharactersCharacterIdContactsQuery,
  zPostCharactersCharacterIdContactsResponse,
  zPostCharactersCharacterIdCspaBody,
  zPostCharactersCharacterIdCspaHeaders,
  zPostCharactersCharacterIdCspaPath,
  zPostCharactersCharacterIdCspaResponse,
  zPostCharactersCharacterIdFittingsBody,
  zPostCharactersCharacterIdFittingsHeaders,
  zPostCharactersCharacterIdFittingsPath,
  zPostCharactersCharacterIdFittingsResponse,
  zPostCharactersCharacterIdMailBody,
  zPostCharactersCharacterIdMailHeaders,
  zPostCharactersCharacterIdMailLabelsBody,
  zPostCharactersCharacterIdMailLabelsHeaders,
  zPostCharactersCharacterIdMailLabelsPath,
  zPostCharactersCharacterIdMailLabelsResponse,
  zPostCharactersCharacterIdMailPath,
  zPostCharactersCharacterIdMailResponse,
  zPostCorporationsCorporationIdAssetsLocationsBody,
  zPostCorporationsCorporationIdAssetsLocationsHeaders,
  zPostCorporationsCorporationIdAssetsLocationsPath,
  zPostCorporationsCorporationIdAssetsLocationsResponse,
  zPostCorporationsCorporationIdAssetsNamesBody,
  zPostCorporationsCorporationIdAssetsNamesHeaders,
  zPostCorporationsCorporationIdAssetsNamesPath,
  zPostCorporationsCorporationIdAssetsNamesResponse,
  zPostFleetsFleetIdMembersBody,
  zPostFleetsFleetIdMembersHeaders,
  zPostFleetsFleetIdMembersPath,
  zPostFleetsFleetIdMembersResponse,
  zPostFleetsFleetIdWingsHeaders,
  zPostFleetsFleetIdWingsPath,
  zPostFleetsFleetIdWingsResponse,
  zPostFleetsFleetIdWingsWingIdSquadsHeaders,
  zPostFleetsFleetIdWingsWingIdSquadsPath,
  zPostFleetsFleetIdWingsWingIdSquadsResponse,
  zPostRouteBody,
  zPostRouteHeaders,
  zPostRoutePath,
  zPostRouteResponse,
  zPostUiAutopilotWaypointHeaders,
  zPostUiAutopilotWaypointQuery,
  zPostUiAutopilotWaypointResponse,
  zPostUiOpenwindowContractHeaders,
  zPostUiOpenwindowContractQuery,
  zPostUiOpenwindowContractResponse,
  zPostUiOpenwindowInformationHeaders,
  zPostUiOpenwindowInformationQuery,
  zPostUiOpenwindowInformationResponse,
  zPostUiOpenwindowMarketdetailsHeaders,
  zPostUiOpenwindowMarketdetailsQuery,
  zPostUiOpenwindowMarketdetailsResponse,
  zPostUiOpenwindowNewmailBody,
  zPostUiOpenwindowNewmailHeaders,
  zPostUiOpenwindowNewmailResponse,
  zPostUniverseIdsBody,
  zPostUniverseIdsHeaders,
  zPostUniverseIdsResponse,
  zPostUniverseNamesBody,
  zPostUniverseNamesHeaders,
  zPostUniverseNamesResponse,
  zPutCharactersCharacterIdCalendarEventIdBody,
  zPutCharactersCharacterIdCalendarEventIdHeaders,
  zPutCharactersCharacterIdCalendarEventIdPath,
  zPutCharactersCharacterIdCalendarEventIdResponse,
  zPutCharactersCharacterIdContactsBody,
  zPutCharactersCharacterIdContactsHeaders,
  zPutCharactersCharacterIdContactsPath,
  zPutCharactersCharacterIdContactsQuery,
  zPutCharactersCharacterIdContactsResponse,
  zPutCharactersCharacterIdMailMailIdBody,
  zPutCharactersCharacterIdMailMailIdHeaders,
  zPutCharactersCharacterIdMailMailIdPath,
  zPutCharactersCharacterIdMailMailIdResponse,
  zPutFleetsFleetIdBody,
  zPutFleetsFleetIdHeaders,
  zPutFleetsFleetIdMembersMemberIdBody,
  zPutFleetsFleetIdMembersMemberIdHeaders,
  zPutFleetsFleetIdMembersMemberIdPath,
  zPutFleetsFleetIdMembersMemberIdResponse,
  zPutFleetsFleetIdPath,
  zPutFleetsFleetIdResponse,
  zPutFleetsFleetIdSquadsSquadIdBody,
  zPutFleetsFleetIdSquadsSquadIdHeaders,
  zPutFleetsFleetIdSquadsSquadIdPath,
  zPutFleetsFleetIdSquadsSquadIdResponse,
  zPutFleetsFleetIdWingsWingIdBody,
  zPutFleetsFleetIdWingsWingIdHeaders,
  zPutFleetsFleetIdWingsWingIdPath,
  zPutFleetsFleetIdWingsWingIdResponse,
  zRaceId,
  zRegionId,
  zRoute,
  zRouteConnection,
  zRouteRequestBody,
  zShipTreeGroupId,
  zSkyhooksRaidable,
  zSkyhooksRaidableTheftvulnerability,
  zSkyhooksRaidableVulnerableskyhook,
  zSolarSystemId,
  zSovereigntyCampaignsGet,
  zSovereigntySystems,
  zSovereigntySystemsAlliance,
  zSovereigntySystemsDevelopment,
  zSovereigntySystemsFaction,
  zSovereigntySystemsSolarsystem,
  zSovereigntySystemsSovereigntyhub,
  zSovereigntySystemsVulnerabilitywindow,
  zStationId,
  zStatus,
  zTenant,
  zTypeId,
  zUniverseAncestriesGet,
  zUniverseAsteroidBeltsAsteroidBeltIdGet,
  zUniverseBloodlinesGet,
  zUniverseCategoriesCategoryIdGet,
  zUniverseCategoriesGet,
  zUniverseConstellationsConstellationIdGet,
  zUniverseConstellationsGet,
  zUniverseFactionsGet,
  zUniverseGraphicsGet,
  zUniverseGraphicsGraphicIdGet,
  zUniverseGroupsGet,
  zUniverseGroupsGroupIdGet,
  zUniverseIdsPost,
  zUniverseMoonsMoonIdGet,
  zUniverseNamesPost,
  zUniversePlanetsPlanetIdGet,
  zUniverseRacesGet,
  zUniverseRegionsGet,
  zUniverseRegionsRegionIdGet,
  zUniverseSchematicsSchematicIdGet,
  zUniverseStargatesStargateIdGet,
  zUniverseStarsStarIdGet,
  zUniverseStationsStationIdGet,
  zUniverseStructuresGet,
  zUniverseStructuresStructureIdGet,
  zUniverseSystemJumpsGet,
  zUniverseSystemKillsGet,
  zUniverseSystemsGet,
  zUniverseSystemsSystemIdGet,
  zUniverseTypesGet,
  zUniverseTypesTypeIdGet,
  zUuid,
  zWarsGet,
  zWarsWarIdGet,
  zWarsWarIdKillmailsGet
};
