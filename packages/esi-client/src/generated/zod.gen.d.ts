import * as z from 'zod';
export declare const zAccessListId: z.ZodInt;
export declare const zAllianceId: z.ZodInt;
export declare const zAlliancesAllianceIdContactsGet: z.ZodArray<z.ZodObject<{
    contact_id: z.ZodInt;
    contact_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
    }>;
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zAlliancesAllianceIdContactsLabelsGet: z.ZodArray<z.ZodObject<{
    label_id: z.ZodInt;
    label_name: z.ZodString;
}, z.core.$loose>>;
export declare const zAlliancesAllianceIdCorporationsGet: z.ZodArray<z.ZodInt>;
export declare const zAlliancesAllianceIdIconsGet: z.ZodObject<{
    px128x128: z.ZodOptional<z.ZodString>;
    px64x64: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zAlliancesGet: z.ZodArray<z.ZodInt>;
export declare const zArchetypeId: z.ZodInt;
export declare const zAttributeId: z.ZodInt;
export declare const zBloodlineId: z.ZodInt;
export declare const zCharacterId: z.ZodInt;
export declare const zCharactersAccessListsDetailAllianceentry: z.ZodObject<{
    access: z.ZodEnum<{
        Admin: "Admin";
        Allowed: "Allowed";
        Blocked: "Blocked";
        Manager: "Manager";
        Unspecified: "Unspecified";
    }>;
    alliance_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersAccessListsDetailCharacterentry: z.ZodObject<{
    access: z.ZodEnum<{
        Admin: "Admin";
        Allowed: "Allowed";
        Blocked: "Blocked";
        Manager: "Manager";
        Unspecified: "Unspecified";
    }>;
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersAccessListsListingAccesslist: z.ZodObject<{
    id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersAccessListsListing: z.ZodObject<{
    access_lists: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersAffiliationPost: z.ZodArray<z.ZodObject<{
    alliance_id: z.ZodOptional<z.ZodInt>;
    character_id: z.ZodInt;
    corporation_id: z.ZodInt;
    faction_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdAgentsResearchGet: z.ZodArray<z.ZodObject<{
    agent_id: z.ZodInt;
    points_per_day: z.ZodNumber;
    remainder_points: z.ZodNumber;
    skill_type_id: z.ZodInt;
    started_at: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdAssetsGet: z.ZodArray<z.ZodObject<{
    is_blueprint_copy: z.ZodOptional<z.ZodBoolean>;
    is_singleton: z.ZodBoolean;
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        BoosterBay: "BoosterBay";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CorpseBay: "CorpseBay";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        InfrastructureHangar: "InfrastructureHangar";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        QuafeBay: "QuafeBay";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        ShipHangar: "ShipHangar";
        Skill: "Skill";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureDeedBay: "StructureDeedBay";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    location_type: z.ZodEnum<{
        item: "item";
        other: "other";
        solar_system: "solar_system";
        station: "station";
    }>;
    quantity: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdAssetsLocationsPost: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdAssetsNamesPost: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdAttributesGet: z.ZodObject<{
    accrued_remap_cooldown_date: z.ZodOptional<z.ZodISODateTime>;
    bonus_remaps: z.ZodOptional<z.ZodInt>;
    charisma: z.ZodInt;
    intelligence: z.ZodInt;
    last_remap_date: z.ZodOptional<z.ZodISODateTime>;
    memory: z.ZodInt;
    perception: z.ZodInt;
    willpower: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersCharacterIdBlueprintsGet: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Cargo: "Cargo";
        CorpseBay: "CorpseBay";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        Module: "Module";
        QuafeBay: "QuafeBay";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        ShipHangar: "ShipHangar";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
    }>;
    location_id: z.ZodInt;
    material_efficiency: z.ZodInt;
    quantity: z.ZodInt;
    runs: z.ZodInt;
    time_efficiency: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
/**
 * List of attendees for a given event
 */
export declare const zCharactersCharacterIdCalendarEventIdAttendeesGet: z.ZodArray<z.ZodObject<{
    character_id: z.ZodOptional<z.ZodInt>;
    event_response: z.ZodOptional<z.ZodEnum<{
        accepted: "accepted";
        declined: "declined";
        not_responded: "not_responded";
        tentative: "tentative";
    }>>;
}, z.core.$loose>>;
/**
 * Full details of a specific event
 */
export declare const zCharactersCharacterIdCalendarEventIdGet: z.ZodObject<{
    date: z.ZodISODateTime;
    duration: z.ZodInt;
    event_id: z.ZodInt;
    importance: z.ZodInt;
    owner_id: z.ZodInt;
    owner_name: z.ZodString;
    owner_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        eve_server: "eve_server";
        faction: "faction";
    }>;
    response: z.ZodString;
    text: z.ZodString;
    title: z.ZodString;
}, z.core.$loose>;
/**
 * Up to 50 events from now or the event you requested
 */
export declare const zCharactersCharacterIdCalendarGet: z.ZodArray<z.ZodObject<{
    event_date: z.ZodOptional<z.ZodISODateTime>;
    event_id: z.ZodOptional<z.ZodInt>;
    event_response: z.ZodOptional<z.ZodEnum<{
        accepted: "accepted";
        declined: "declined";
        not_responded: "not_responded";
        tentative: "tentative";
    }>>;
    importance: z.ZodOptional<z.ZodInt>;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdClonesGet: z.ZodObject<{
    home_location: z.ZodOptional<z.ZodObject<{
        location_id: z.ZodOptional<z.ZodInt>;
        location_type: z.ZodOptional<z.ZodEnum<{
            station: "station";
            structure: "structure";
        }>>;
    }, z.core.$loose>>;
    jump_clones: z.ZodArray<z.ZodObject<{
        implants: z.ZodArray<z.ZodInt>;
        jump_clone_id: z.ZodInt;
        location_id: z.ZodInt;
        location_type: z.ZodEnum<{
            station: "station";
            structure: "structure";
        }>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    last_clone_jump_date: z.ZodOptional<z.ZodISODateTime>;
    last_station_change_date: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdContactsGet: z.ZodArray<z.ZodObject<{
    contact_id: z.ZodInt;
    contact_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
    }>;
    is_blocked: z.ZodOptional<z.ZodBoolean>;
    is_watched: z.ZodOptional<z.ZodBoolean>;
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdContactsLabelsGet: z.ZodArray<z.ZodObject<{
    label_id: z.ZodInt;
    label_name: z.ZodString;
}, z.core.$loose>>;
/**
 * 201 created array
 */
export declare const zCharactersCharacterIdContactsPost: z.ZodArray<z.ZodInt>;
export declare const zCharactersCharacterIdContractsContractIdBidsGet: z.ZodArray<z.ZodObject<{
    amount: z.ZodNumber;
    bid_id: z.ZodInt;
    bidder_id: z.ZodInt;
    date_bid: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdContractsContractIdItemsGet: z.ZodArray<z.ZodObject<{
    is_included: z.ZodBoolean;
    is_singleton: z.ZodBoolean;
    quantity: z.ZodInt;
    raw_quantity: z.ZodOptional<z.ZodInt>;
    record_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdContractsGet: z.ZodArray<z.ZodObject<{
    acceptor_id: z.ZodInt;
    assignee_id: z.ZodInt;
    availability: z.ZodEnum<{
        alliance: "alliance";
        corporation: "corporation";
        personal: "personal";
        public: "public";
    }>;
    buyout: z.ZodOptional<z.ZodNumber>;
    collateral: z.ZodOptional<z.ZodNumber>;
    contract_id: z.ZodInt;
    date_accepted: z.ZodOptional<z.ZodISODateTime>;
    date_completed: z.ZodOptional<z.ZodISODateTime>;
    date_expired: z.ZodISODateTime;
    date_issued: z.ZodISODateTime;
    days_to_complete: z.ZodOptional<z.ZodInt>;
    end_location_id: z.ZodOptional<z.ZodInt>;
    for_corporation: z.ZodBoolean;
    issuer_corporation_id: z.ZodInt;
    issuer_id: z.ZodInt;
    price: z.ZodOptional<z.ZodNumber>;
    reward: z.ZodOptional<z.ZodNumber>;
    start_location_id: z.ZodOptional<z.ZodInt>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        deleted: "deleted";
        failed: "failed";
        finished: "finished";
        finished_contractor: "finished_contractor";
        finished_issuer: "finished_issuer";
        in_progress: "in_progress";
        outstanding: "outstanding";
        rejected: "rejected";
        reversed: "reversed";
    }>;
    title: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        auction: "auction";
        courier: "courier";
        item_exchange: "item_exchange";
        loan: "loan";
        unknown: "unknown";
    }>;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdCorporationhistoryGet: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    is_deleted: z.ZodOptional<z.ZodBoolean>;
    record_id: z.ZodInt;
    start_date: z.ZodISODateTime;
}, z.core.$loose>>;
/**
 * 201 created number
 */
export declare const zCharactersCharacterIdCspaPost: z.ZodNumber;
export declare const zCharactersCharacterIdFatigueGet: z.ZodObject<{
    jump_fatigue_expire_date: z.ZodOptional<z.ZodISODateTime>;
    last_jump_date: z.ZodOptional<z.ZodISODateTime>;
    last_update_date: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdFittingsGet: z.ZodArray<z.ZodObject<{
    description: z.ZodString;
    fitting_id: z.ZodInt;
    items: z.ZodArray<z.ZodObject<{
        flag: z.ZodEnum<{
            Cargo: "Cargo";
            DroneBay: "DroneBay";
            FighterBay: "FighterBay";
            HiSlot0: "HiSlot0";
            HiSlot1: "HiSlot1";
            HiSlot2: "HiSlot2";
            HiSlot3: "HiSlot3";
            HiSlot4: "HiSlot4";
            HiSlot5: "HiSlot5";
            HiSlot6: "HiSlot6";
            HiSlot7: "HiSlot7";
            Invalid: "Invalid";
            LoSlot0: "LoSlot0";
            LoSlot1: "LoSlot1";
            LoSlot2: "LoSlot2";
            LoSlot3: "LoSlot3";
            LoSlot4: "LoSlot4";
            LoSlot5: "LoSlot5";
            LoSlot6: "LoSlot6";
            LoSlot7: "LoSlot7";
            MedSlot0: "MedSlot0";
            MedSlot1: "MedSlot1";
            MedSlot2: "MedSlot2";
            MedSlot3: "MedSlot3";
            MedSlot4: "MedSlot4";
            MedSlot5: "MedSlot5";
            MedSlot6: "MedSlot6";
            MedSlot7: "MedSlot7";
            RigSlot0: "RigSlot0";
            RigSlot1: "RigSlot1";
            RigSlot2: "RigSlot2";
            ServiceSlot0: "ServiceSlot0";
            ServiceSlot1: "ServiceSlot1";
            ServiceSlot2: "ServiceSlot2";
            ServiceSlot3: "ServiceSlot3";
            ServiceSlot4: "ServiceSlot4";
            ServiceSlot5: "ServiceSlot5";
            ServiceSlot6: "ServiceSlot6";
            ServiceSlot7: "ServiceSlot7";
            SubSystemSlot0: "SubSystemSlot0";
            SubSystemSlot1: "SubSystemSlot1";
            SubSystemSlot2: "SubSystemSlot2";
            SubSystemSlot3: "SubSystemSlot3";
        }>;
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    name: z.ZodString;
    ship_type_id: z.ZodInt;
}, z.core.$loose>>;
/**
 * 201 created object
 */
export declare const zCharactersCharacterIdFittingsPost: z.ZodObject<{
    fitting_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersCharacterIdFleetGet: z.ZodObject<{
    fleet_boss_id: z.ZodInt;
    fleet_id: z.ZodInt;
    role: z.ZodEnum<{
        fleet_commander: "fleet_commander";
        squad_commander: "squad_commander";
        squad_member: "squad_member";
        wing_commander: "wing_commander";
    }>;
    squad_id: z.ZodInt;
    wing_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersCharacterIdFwStatsGet: z.ZodObject<{
    current_rank: z.ZodOptional<z.ZodInt>;
    enlisted_on: z.ZodOptional<z.ZodISODateTime>;
    faction_id: z.ZodOptional<z.ZodInt>;
    highest_rank: z.ZodOptional<z.ZodInt>;
    kills: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdImplantsGet: z.ZodArray<z.ZodInt>;
export declare const zCharactersCharacterIdIndustryJobsGet: z.ZodArray<z.ZodObject<{
    activity_id: z.ZodInt;
    blueprint_id: z.ZodInt;
    blueprint_location_id: z.ZodInt;
    blueprint_type_id: z.ZodInt;
    completed_character_id: z.ZodOptional<z.ZodInt>;
    completed_date: z.ZodOptional<z.ZodISODateTime>;
    cost: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodInt;
    end_date: z.ZodISODateTime;
    facility_id: z.ZodInt;
    installer_id: z.ZodInt;
    job_id: z.ZodInt;
    licensed_runs: z.ZodOptional<z.ZodInt>;
    output_location_id: z.ZodInt;
    pause_date: z.ZodOptional<z.ZodISODateTime>;
    probability: z.ZodOptional<z.ZodNumber>;
    product_type_id: z.ZodOptional<z.ZodInt>;
    runs: z.ZodInt;
    start_date: z.ZodISODateTime;
    station_id: z.ZodInt;
    status: z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        delivered: "delivered";
        paused: "paused";
        ready: "ready";
        reverted: "reverted";
    }>;
    successful_runs: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdKillmailsRecentGet: z.ZodArray<z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdLocationGet: z.ZodObject<{
    solar_system_id: z.ZodInt;
    station_id: z.ZodOptional<z.ZodInt>;
    structure_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdLoyaltyPointsGet: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    loyalty_points: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdMailGet: z.ZodArray<z.ZodObject<{
    from: z.ZodOptional<z.ZodInt>;
    is_read: z.ZodOptional<z.ZodBoolean>;
    labels: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    mail_id: z.ZodOptional<z.ZodInt>;
    recipients: z.ZodOptional<z.ZodArray<z.ZodObject<{
        recipient_id: z.ZodInt;
        recipient_type: z.ZodEnum<{
            alliance: "alliance";
            character: "character";
            corporation: "corporation";
            mailing_list: "mailing_list";
        }>;
    }, z.core.$loose>>>;
    subject: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdMailLabelsGet: z.ZodObject<{
    labels: z.ZodOptional<z.ZodArray<z.ZodObject<{
        color: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            "#0000fe": "#0000fe";
            "#006634": "#006634";
            "#0099ff": "#0099ff";
            "#00ff33": "#00ff33";
            "#01ffff": "#01ffff";
            "#349800": "#349800";
            "#660066": "#660066";
            "#666666": "#666666";
            "#999999": "#999999";
            "#99ffff": "#99ffff";
            "#9a0000": "#9a0000";
            "#ccff9a": "#ccff9a";
            "#e6e6e6": "#e6e6e6";
            "#fe0000": "#fe0000";
            "#ff6600": "#ff6600";
            "#ffff01": "#ffff01";
            "#ffffcd": "#ffffcd";
            "#ffffff": "#ffffff";
        }>>>;
        label_id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
        unread_count: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    total_unread_count: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * Label ID
 */
export declare const zCharactersCharacterIdMailLabelsPost: z.ZodInt;
export declare const zCharactersCharacterIdMailListsGet: z.ZodArray<z.ZodObject<{
    mailing_list_id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdMailMailIdGet: z.ZodObject<{
    body: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodInt>;
    labels: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    read: z.ZodOptional<z.ZodBoolean>;
    recipients: z.ZodOptional<z.ZodArray<z.ZodObject<{
        recipient_id: z.ZodInt;
        recipient_type: z.ZodEnum<{
            alliance: "alliance";
            character: "character";
            corporation: "corporation";
            mailing_list: "mailing_list";
        }>;
    }, z.core.$loose>>>;
    subject: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
/**
 * Mail ID
 */
export declare const zCharactersCharacterIdMailPost: z.ZodInt;
export declare const zCharactersCharacterIdMedalsGet: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    date: z.ZodISODateTime;
    description: z.ZodString;
    graphics: z.ZodArray<z.ZodObject<{
        color: z.ZodOptional<z.ZodInt>;
        graphic: z.ZodString;
        layer: z.ZodInt;
        part: z.ZodInt;
    }, z.core.$loose>>;
    issuer_id: z.ZodInt;
    medal_id: z.ZodInt;
    reason: z.ZodString;
    status: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
    title: z.ZodString;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdMiningGet: z.ZodArray<z.ZodObject<{
    date: z.ZodISODate;
    quantity: z.ZodInt;
    solar_system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdNotificationsContactsGet: z.ZodArray<z.ZodObject<{
    message: z.ZodString;
    notification_id: z.ZodInt;
    send_date: z.ZodISODateTime;
    sender_character_id: z.ZodInt;
    standing_level: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdNotificationsGet: z.ZodArray<z.ZodObject<{
    is_read: z.ZodOptional<z.ZodBoolean>;
    notification_id: z.ZodInt;
    sender_id: z.ZodInt;
    sender_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
        other: "other";
    }>;
    text: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodISODateTime;
    type: z.ZodEnum<{
        AcceptedAlly: "AcceptedAlly";
        AcceptedSurrender: "AcceptedSurrender";
        AgentRetiredTrigravian: "AgentRetiredTrigravian";
        AllAnchoringMsg: "AllAnchoringMsg";
        AllMaintenanceBillMsg: "AllMaintenanceBillMsg";
        AllStrucInvulnerableMsg: "AllStrucInvulnerableMsg";
        AllStructVulnerableMsg: "AllStructVulnerableMsg";
        AllWarCorpJoinedAllianceMsg: "AllWarCorpJoinedAllianceMsg";
        AllWarDeclaredMsg: "AllWarDeclaredMsg";
        AllWarInvalidatedMsg: "AllWarInvalidatedMsg";
        AllWarRetractedMsg: "AllWarRetractedMsg";
        AllWarSurrenderMsg: "AllWarSurrenderMsg";
        AllianceCapitalChanged: "AllianceCapitalChanged";
        AllianceWarDeclaredV2: "AllianceWarDeclaredV2";
        AllyContractCancelled: "AllyContractCancelled";
        AllyJoinedWarAggressorMsg: "AllyJoinedWarAggressorMsg";
        AllyJoinedWarAllyMsg: "AllyJoinedWarAllyMsg";
        AllyJoinedWarDefenderMsg: "AllyJoinedWarDefenderMsg";
        BattlePunishFriendlyFire: "BattlePunishFriendlyFire";
        BillOutOfMoneyMsg: "BillOutOfMoneyMsg";
        BillPaidCorpAllMsg: "BillPaidCorpAllMsg";
        BountyClaimMsg: "BountyClaimMsg";
        BountyESSShared: "BountyESSShared";
        BountyESSTaken: "BountyESSTaken";
        BountyPlacedAlliance: "BountyPlacedAlliance";
        BountyPlacedChar: "BountyPlacedChar";
        BountyPlacedCorp: "BountyPlacedCorp";
        BountyYourBountyClaimed: "BountyYourBountyClaimed";
        BuddyConnectContactAdd: "BuddyConnectContactAdd";
        CharAppAcceptMsg: "CharAppAcceptMsg";
        CharAppRejectMsg: "CharAppRejectMsg";
        CharAppWithdrawMsg: "CharAppWithdrawMsg";
        CharLeftCorpMsg: "CharLeftCorpMsg";
        CharMedalMsg: "CharMedalMsg";
        CharTerminationMsg: "CharTerminationMsg";
        CloneActivationMsg: "CloneActivationMsg";
        CloneActivationMsg2: "CloneActivationMsg2";
        CloneMovedMsg: "CloneMovedMsg";
        CloneRevokedMsg1: "CloneRevokedMsg1";
        CloneRevokedMsg2: "CloneRevokedMsg2";
        CombatOperationFinished: "CombatOperationFinished";
        ContactAdd: "ContactAdd";
        ContactEdit: "ContactEdit";
        ContainerPasswordMsg: "ContainerPasswordMsg";
        ContractRegionChangedToPochven: "ContractRegionChangedToPochven";
        CorpAllBillMsg: "CorpAllBillMsg";
        CorpAppAcceptMsg: "CorpAppAcceptMsg";
        CorpAppInvitedMsg: "CorpAppInvitedMsg";
        CorpAppNewMsg: "CorpAppNewMsg";
        CorpAppRejectCustomMsg: "CorpAppRejectCustomMsg";
        CorpAppRejectMsg: "CorpAppRejectMsg";
        CorpBecameWarEligible: "CorpBecameWarEligible";
        CorpDividendMsg: "CorpDividendMsg";
        CorpFriendlyFireDisableTimerCompleted: "CorpFriendlyFireDisableTimerCompleted";
        CorpFriendlyFireDisableTimerStarted: "CorpFriendlyFireDisableTimerStarted";
        CorpFriendlyFireEnableTimerCompleted: "CorpFriendlyFireEnableTimerCompleted";
        CorpFriendlyFireEnableTimerStarted: "CorpFriendlyFireEnableTimerStarted";
        CorpKicked: "CorpKicked";
        CorpLiquidationMsg: "CorpLiquidationMsg";
        CorpNewCEOMsg: "CorpNewCEOMsg";
        CorpNewsMsg: "CorpNewsMsg";
        CorpNoLongerWarEligible: "CorpNoLongerWarEligible";
        CorpOfficeExpirationMsg: "CorpOfficeExpirationMsg";
        CorpStructLostMsg: "CorpStructLostMsg";
        CorpTaxChangeMsg: "CorpTaxChangeMsg";
        CorpVoteCEORevokedMsg: "CorpVoteCEORevokedMsg";
        CorpVoteMsg: "CorpVoteMsg";
        CorpWarDeclaredMsg: "CorpWarDeclaredMsg";
        CorpWarDeclaredV2: "CorpWarDeclaredV2";
        CorpWarFightingLegalMsg: "CorpWarFightingLegalMsg";
        CorpWarInvalidatedMsg: "CorpWarInvalidatedMsg";
        CorpWarRetractedMsg: "CorpWarRetractedMsg";
        CorpWarSurrenderMsg: "CorpWarSurrenderMsg";
        CorporationGoalClosed: "CorporationGoalClosed";
        CorporationGoalCompleted: "CorporationGoalCompleted";
        CorporationGoalCreated: "CorporationGoalCreated";
        CorporationGoalExpired: "CorporationGoalExpired";
        CorporationGoalLimitReached: "CorporationGoalLimitReached";
        CorporationGoalNameChange: "CorporationGoalNameChange";
        CorporationLeft: "CorporationLeft";
        CustomsMsg: "CustomsMsg";
        DailyItemRewardAutoClaimed: "DailyItemRewardAutoClaimed";
        DeclareWar: "DeclareWar";
        DistrictAttacked: "DistrictAttacked";
        DustAppAcceptedMsg: "DustAppAcceptedMsg";
        ESSMainBankLink: "ESSMainBankLink";
        EntosisCaptureStarted: "EntosisCaptureStarted";
        ExpertSystemExpired: "ExpertSystemExpired";
        ExpertSystemExpiryImminent: "ExpertSystemExpiryImminent";
        FWAllianceKickCeoIndividualStandingWarning: "FWAllianceKickCeoIndividualStandingWarning";
        FWAllianceKickMsg: "FWAllianceKickMsg";
        FWAllianceKickedCeoIndividualStanding: "FWAllianceKickedCeoIndividualStanding";
        FWAllianceWarningMsg: "FWAllianceWarningMsg";
        FWCharKickMsg: "FWCharKickMsg";
        FWCharRankGainMsg: "FWCharRankGainMsg";
        FWCharRankLossMsg: "FWCharRankLossMsg";
        FWCharWarningMsg: "FWCharWarningMsg";
        FWCharacterKickFromCorpIndividualStandingWarning: "FWCharacterKickFromCorpIndividualStandingWarning";
        FWCharacterKickedFromCorpIndividualStanding: "FWCharacterKickedFromCorpIndividualStanding";
        FWCorpJoinMsg: "FWCorpJoinMsg";
        FWCorpKickMsg: "FWCorpKickMsg";
        FWCorpLeaveMsg: "FWCorpLeaveMsg";
        FWCorpWarningMsg: "FWCorpWarningMsg";
        FWCorporationKickCeoIndividualStandingWarning: "FWCorporationKickCeoIndividualStandingWarning";
        FWCorporationKickedCeoIndividualStanding: "FWCorporationKickedCeoIndividualStanding";
        FacWarCorpJoinRequestMsg: "FacWarCorpJoinRequestMsg";
        FacWarCorpJoinWithdrawMsg: "FacWarCorpJoinWithdrawMsg";
        FacWarCorpLeaveRequestMsg: "FacWarCorpLeaveRequestMsg";
        FacWarCorpLeaveWithdrawMsg: "FacWarCorpLeaveWithdrawMsg";
        FacWarDirectEnlistmentRevoked: "FacWarDirectEnlistmentRevoked";
        FacWarLPDisqualifiedEvent: "FacWarLPDisqualifiedEvent";
        FacWarLPDisqualifiedKill: "FacWarLPDisqualifiedKill";
        FacWarLPPayoutEvent: "FacWarLPPayoutEvent";
        FacWarLPPayoutKill: "FacWarLPPayoutKill";
        FreelanceProjectACLDeleted: "FreelanceProjectACLDeleted";
        FreelanceProjectClosed: "FreelanceProjectClosed";
        FreelanceProjectCompleted: "FreelanceProjectCompleted";
        FreelanceProjectCreated: "FreelanceProjectCreated";
        FreelanceProjectExpired: "FreelanceProjectExpired";
        FreelanceProjectLimitReached: "FreelanceProjectLimitReached";
        FreelanceProjectParticipantKicked: "FreelanceProjectParticipantKicked";
        GameTimeAdded: "GameTimeAdded";
        GameTimeReceived: "GameTimeReceived";
        GameTimeSent: "GameTimeSent";
        GiftReceived: "GiftReceived";
        IHubDestroyedByBillFailure: "IHubDestroyedByBillFailure";
        IncursionCompletedMsg: "IncursionCompletedMsg";
        IndustryOperationFinished: "IndustryOperationFinished";
        IndustryTeamAuctionLost: "IndustryTeamAuctionLost";
        IndustryTeamAuctionWon: "IndustryTeamAuctionWon";
        InfrastructureHubBillAboutToExpire: "InfrastructureHubBillAboutToExpire";
        InsuranceExpirationMsg: "InsuranceExpirationMsg";
        InsuranceFirstShipMsg: "InsuranceFirstShipMsg";
        InsuranceInvalidatedMsg: "InsuranceInvalidatedMsg";
        InsuranceIssuedMsg: "InsuranceIssuedMsg";
        InsurancePayoutMsg: "InsurancePayoutMsg";
        InvasionCompletedMsg: "InvasionCompletedMsg";
        InvasionSystemLogin: "InvasionSystemLogin";
        InvasionSystemStart: "InvasionSystemStart";
        JumpCloneDeletedMsg1: "JumpCloneDeletedMsg1";
        JumpCloneDeletedMsg2: "JumpCloneDeletedMsg2";
        KillReportFinalBlow: "KillReportFinalBlow";
        KillReportVictim: "KillReportVictim";
        KillRightAvailable: "KillRightAvailable";
        KillRightAvailableOpen: "KillRightAvailableOpen";
        KillRightEarned: "KillRightEarned";
        KillRightUnavailable: "KillRightUnavailable";
        KillRightUnavailableOpen: "KillRightUnavailableOpen";
        KillRightUsed: "KillRightUsed";
        LPAutoRedeemed: "LPAutoRedeemed";
        LocateCharMsg: "LocateCharMsg";
        MadeWarMutual: "MadeWarMutual";
        MercOfferRetractedMsg: "MercOfferRetractedMsg";
        MercOfferedNegotiationMsg: "MercOfferedNegotiationMsg";
        MercenaryDenAttacked: "MercenaryDenAttacked";
        MercenaryDenNewMTO: "MercenaryDenNewMTO";
        MercenaryDenReinforced: "MercenaryDenReinforced";
        MissionCanceledTriglavian: "MissionCanceledTriglavian";
        MissionOfferExpirationMsg: "MissionOfferExpirationMsg";
        MissionTimeoutMsg: "MissionTimeoutMsg";
        MoonminingAutomaticFracture: "MoonminingAutomaticFracture";
        MoonminingExtractionCancelled: "MoonminingExtractionCancelled";
        MoonminingExtractionFinished: "MoonminingExtractionFinished";
        MoonminingExtractionStarted: "MoonminingExtractionStarted";
        MoonminingLaserFired: "MoonminingLaserFired";
        MutualWarExpired: "MutualWarExpired";
        MutualWarInviteAccepted: "MutualWarInviteAccepted";
        MutualWarInviteRejected: "MutualWarInviteRejected";
        MutualWarInviteSent: "MutualWarInviteSent";
        NPCStandingsGained: "NPCStandingsGained";
        NPCStandingsLost: "NPCStandingsLost";
        OfferToAllyRetracted: "OfferToAllyRetracted";
        OfferedSurrender: "OfferedSurrender";
        OfferedToAlly: "OfferedToAlly";
        OfficeLeaseCanceledInsufficientStandings: "OfficeLeaseCanceledInsufficientStandings";
        OldLscMessages: "OldLscMessages";
        OperationFinished: "OperationFinished";
        OrbitalAttacked: "OrbitalAttacked";
        OrbitalReinforced: "OrbitalReinforced";
        OwnershipTransferred: "OwnershipTransferred";
        RaffleCreated: "RaffleCreated";
        RaffleExpired: "RaffleExpired";
        RaffleFinished: "RaffleFinished";
        ReimbursementMsg: "ReimbursementMsg";
        ResearchMissionAvailableMsg: "ResearchMissionAvailableMsg";
        RetractsWar: "RetractsWar";
        SPAutoRedeemed: "SPAutoRedeemed";
        SeasonalChallengeCompleted: "SeasonalChallengeCompleted";
        SkinSequencingCompleted: "SkinSequencingCompleted";
        SkyhookDeployed: "SkyhookDeployed";
        SkyhookDestroyed: "SkyhookDestroyed";
        SkyhookLostShields: "SkyhookLostShields";
        SkyhookOnline: "SkyhookOnline";
        SkyhookUnderAttack: "SkyhookUnderAttack";
        SovAllClaimAquiredMsg: "SovAllClaimAquiredMsg";
        SovAllClaimLostMsg: "SovAllClaimLostMsg";
        SovCommandNodeEventStarted: "SovCommandNodeEventStarted";
        SovCorpBillLateMsg: "SovCorpBillLateMsg";
        SovCorpClaimFailMsg: "SovCorpClaimFailMsg";
        SovDisruptorMsg: "SovDisruptorMsg";
        SovStationEnteredFreeport: "SovStationEnteredFreeport";
        SovStructureDestroyed: "SovStructureDestroyed";
        SovStructureReinforced: "SovStructureReinforced";
        SovStructureSelfDestructCancel: "SovStructureSelfDestructCancel";
        SovStructureSelfDestructFinished: "SovStructureSelfDestructFinished";
        SovStructureSelfDestructRequested: "SovStructureSelfDestructRequested";
        SovereigntyIHDamageMsg: "SovereigntyIHDamageMsg";
        SovereigntySBUDamageMsg: "SovereigntySBUDamageMsg";
        SovereigntyTCUDamageMsg: "SovereigntyTCUDamageMsg";
        StationAggressionMsg1: "StationAggressionMsg1";
        StationAggressionMsg2: "StationAggressionMsg2";
        StationConquerMsg: "StationConquerMsg";
        StationServiceDisabled: "StationServiceDisabled";
        StationServiceEnabled: "StationServiceEnabled";
        StationStateChangeMsg: "StationStateChangeMsg";
        StoryLineMissionAvailableMsg: "StoryLineMissionAvailableMsg";
        StructureAnchoring: "StructureAnchoring";
        StructureCourierContractChanged: "StructureCourierContractChanged";
        StructureDestroyed: "StructureDestroyed";
        StructureFuelAlert: "StructureFuelAlert";
        StructureImpendingAbandonmentAssetsAtRisk: "StructureImpendingAbandonmentAssetsAtRisk";
        StructureItemsDelivered: "StructureItemsDelivered";
        StructureItemsMovedToSafety: "StructureItemsMovedToSafety";
        StructureLostArmor: "StructureLostArmor";
        StructureLostShields: "StructureLostShields";
        StructureLowReagentsAlert: "StructureLowReagentsAlert";
        StructureNoReagentsAlert: "StructureNoReagentsAlert";
        StructureOnline: "StructureOnline";
        StructurePaintPurchased: "StructurePaintPurchased";
        StructureServicesOffline: "StructureServicesOffline";
        StructureUnanchoring: "StructureUnanchoring";
        StructureUnderAttack: "StructureUnderAttack";
        StructureWentHighPower: "StructureWentHighPower";
        StructureWentLowPower: "StructureWentLowPower";
        StructuresJobsCancelled: "StructuresJobsCancelled";
        StructuresJobsPaused: "StructuresJobsPaused";
        StructuresReinforcementChanged: "StructuresReinforcementChanged";
        TowerAlertMsg: "TowerAlertMsg";
        TowerResourceAlertMsg: "TowerResourceAlertMsg";
        TransactionReversalMsg: "TransactionReversalMsg";
        TutorialMsg: "TutorialMsg";
        "WarAdopted ": "WarAdopted ";
        WarAllyInherited: "WarAllyInherited";
        WarAllyOfferDeclinedMsg: "WarAllyOfferDeclinedMsg";
        WarConcordInvalidates: "WarConcordInvalidates";
        WarDeclared: "WarDeclared";
        WarEndedHqSecurityDrop: "WarEndedHqSecurityDrop";
        WarHQRemovedFromSpace: "WarHQRemovedFromSpace";
        WarInherited: "WarInherited";
        WarInvalid: "WarInvalid";
        WarRetracted: "WarRetracted";
        WarRetractedByConcord: "WarRetractedByConcord";
        WarSurrenderDeclinedMsg: "WarSurrenderDeclinedMsg";
        WarSurrenderOfferMsg: "WarSurrenderOfferMsg";
    }>;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdOnlineGet: z.ZodObject<{
    last_login: z.ZodOptional<z.ZodISODateTime>;
    last_logout: z.ZodOptional<z.ZodISODateTime>;
    logins: z.ZodOptional<z.ZodInt>;
    online: z.ZodBoolean;
}, z.core.$loose>;
export declare const zCharactersCharacterIdOrdersGet: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    is_corporation: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdOrdersHistoryGet: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    is_corporation: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    state: z.ZodEnum<{
        cancelled: "cancelled";
        expired: "expired";
    }>;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdPlanetsGet: z.ZodArray<z.ZodObject<{
    last_update: z.ZodISODateTime;
    num_pins: z.ZodInt;
    owner_id: z.ZodInt;
    planet_id: z.ZodInt;
    planet_type: z.ZodEnum<{
        barren: "barren";
        gas: "gas";
        ice: "ice";
        lava: "lava";
        oceanic: "oceanic";
        plasma: "plasma";
        storm: "storm";
        temperate: "temperate";
    }>;
    solar_system_id: z.ZodInt;
    upgrade_level: z.ZodInt;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdPlanetsPlanetIdGet: z.ZodObject<{
    links: z.ZodArray<z.ZodObject<{
        destination_pin_id: z.ZodInt;
        link_level: z.ZodInt;
        source_pin_id: z.ZodInt;
    }, z.core.$loose>>;
    pins: z.ZodArray<z.ZodObject<{
        contents: z.ZodOptional<z.ZodArray<z.ZodObject<{
            amount: z.ZodInt;
            type_id: z.ZodInt;
        }, z.core.$loose>>>;
        expiry_time: z.ZodOptional<z.ZodISODateTime>;
        extractor_details: z.ZodOptional<z.ZodObject<{
            cycle_time: z.ZodOptional<z.ZodInt>;
            head_radius: z.ZodOptional<z.ZodNumber>;
            heads: z.ZodArray<z.ZodObject<{
                head_id: z.ZodInt;
                latitude: z.ZodNumber;
                longitude: z.ZodNumber;
            }, z.core.$loose>>;
            product_type_id: z.ZodOptional<z.ZodInt>;
            qty_per_cycle: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        factory_details: z.ZodOptional<z.ZodObject<{
            schematic_id: z.ZodInt;
        }, z.core.$loose>>;
        install_time: z.ZodOptional<z.ZodISODateTime>;
        last_cycle_start: z.ZodOptional<z.ZodISODateTime>;
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
        pin_id: z.ZodInt;
        schematic_id: z.ZodOptional<z.ZodInt>;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    routes: z.ZodArray<z.ZodObject<{
        content_type_id: z.ZodInt;
        destination_pin_id: z.ZodInt;
        quantity: z.ZodNumber;
        route_id: z.ZodInt;
        source_pin_id: z.ZodInt;
        waypoints: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdPortraitGet: z.ZodObject<{
    px128x128: z.ZodOptional<z.ZodString>;
    px256x256: z.ZodOptional<z.ZodString>;
    px512x512: z.ZodOptional<z.ZodString>;
    px64x64: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdRolesGet: z.ZodObject<{
    roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdSearchGet: z.ZodObject<{
    agent: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    alliance: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    character: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    constellation: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    corporation: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    faction: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    inventory_type: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    region: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    solar_system: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    station: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    structure: z.ZodOptional<z.ZodArray<z.ZodInt>>;
}, z.core.$loose>;
export declare const zCharactersCharacterIdShipGet: z.ZodObject<{
    ship_item_id: z.ZodInt;
    ship_name: z.ZodString;
    ship_type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersCharacterIdStandingsGet: z.ZodArray<z.ZodObject<{
    from_id: z.ZodInt;
    from_type: z.ZodEnum<{
        agent: "agent";
        faction: "faction";
        npc_corp: "npc_corp";
    }>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCharactersCharacterIdTitlesGet: z.ZodArray<z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    title_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
/**
 * Wallet balance
 */
export declare const zCharactersCharacterIdWalletGet: z.ZodNumber;
/**
 * Wallet journal entries
 */
export declare const zCharactersCharacterIdWalletJournalGet: z.ZodArray<z.ZodObject<{
    amount: z.ZodOptional<z.ZodNumber>;
    balance: z.ZodOptional<z.ZodNumber>;
    context_id: z.ZodOptional<z.ZodInt>;
    context_id_type: z.ZodOptional<z.ZodEnum<{
        alliance_id: "alliance_id";
        character_id: "character_id";
        contract_id: "contract_id";
        corporation_id: "corporation_id";
        eve_system: "eve_system";
        industry_job_id: "industry_job_id";
        market_transaction_id: "market_transaction_id";
        planet_id: "planet_id";
        station_id: "station_id";
        structure_id: "structure_id";
        system_id: "system_id";
        type_id: "type_id";
    }>>;
    date: z.ZodISODateTime;
    description: z.ZodString;
    first_party_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    reason: z.ZodOptional<z.ZodString>;
    ref_type: z.ZodEnum<{
        acceleration_gate_fee: "acceleration_gate_fee";
        achievement_category_milestone_reward: "achievement_category_milestone_reward";
        achievement_milestone_reward: "achievement_milestone_reward";
        advertisement_listing_fee: "advertisement_listing_fee";
        agent_donation: "agent_donation";
        agent_location_services: "agent_location_services";
        agent_miscellaneous: "agent_miscellaneous";
        agent_mission_collateral_paid: "agent_mission_collateral_paid";
        agent_mission_collateral_refunded: "agent_mission_collateral_refunded";
        agent_mission_reward: "agent_mission_reward";
        agent_mission_reward_corporation_tax: "agent_mission_reward_corporation_tax";
        agent_mission_security_tax: "agent_mission_security_tax";
        agent_mission_time_bonus_reward: "agent_mission_time_bonus_reward";
        agent_mission_time_bonus_reward_corporation_tax: "agent_mission_time_bonus_reward_corporation_tax";
        agent_security_services: "agent_security_services";
        agent_services_rendered: "agent_services_rendered";
        agents_preward: "agents_preward";
        air_career_program_reward: "air_career_program_reward";
        alliance_maintainance_fee: "alliance_maintainance_fee";
        alliance_registration_fee: "alliance_registration_fee";
        allignment_based_gate_toll: "allignment_based_gate_toll";
        asset_safety_recovery_tax: "asset_safety_recovery_tax";
        bounty: "bounty";
        bounty_prize: "bounty_prize";
        bounty_prize_corporation_tax: "bounty_prize_corporation_tax";
        bounty_prizes: "bounty_prizes";
        bounty_reimbursement: "bounty_reimbursement";
        bounty_surcharge: "bounty_surcharge";
        brokers_fee: "brokers_fee";
        campaign_objective_isk_reward: "campaign_objective_isk_reward";
        clone_activation: "clone_activation";
        clone_transfer: "clone_transfer";
        contraband_fine: "contraband_fine";
        contract_auction_bid: "contract_auction_bid";
        contract_auction_bid_corp: "contract_auction_bid_corp";
        contract_auction_bid_refund: "contract_auction_bid_refund";
        contract_auction_sold: "contract_auction_sold";
        contract_brokers_fee: "contract_brokers_fee";
        contract_brokers_fee_corp: "contract_brokers_fee_corp";
        contract_collateral: "contract_collateral";
        contract_collateral_deposited_corp: "contract_collateral_deposited_corp";
        contract_collateral_payout: "contract_collateral_payout";
        contract_collateral_refund: "contract_collateral_refund";
        contract_deposit: "contract_deposit";
        contract_deposit_corp: "contract_deposit_corp";
        contract_deposit_refund: "contract_deposit_refund";
        contract_deposit_sales_tax: "contract_deposit_sales_tax";
        contract_price: "contract_price";
        contract_price_payment_corp: "contract_price_payment_corp";
        contract_reversal: "contract_reversal";
        contract_reward: "contract_reward";
        contract_reward_deposited: "contract_reward_deposited";
        contract_reward_deposited_corp: "contract_reward_deposited_corp";
        contract_reward_refund: "contract_reward_refund";
        contract_sales_tax: "contract_sales_tax";
        copying: "copying";
        corporate_reward_payout: "corporate_reward_payout";
        corporate_reward_tax: "corporate_reward_tax";
        corporation_account_withdrawal: "corporation_account_withdrawal";
        corporation_bulk_payment: "corporation_bulk_payment";
        corporation_dividend_payment: "corporation_dividend_payment";
        corporation_liquidation: "corporation_liquidation";
        corporation_logo_change_cost: "corporation_logo_change_cost";
        corporation_payment: "corporation_payment";
        corporation_registration_fee: "corporation_registration_fee";
        cosmetic_market_component_item_purchase: "cosmetic_market_component_item_purchase";
        cosmetic_market_skin_purchase: "cosmetic_market_skin_purchase";
        cosmetic_market_skin_sale: "cosmetic_market_skin_sale";
        cosmetic_market_skin_sale_broker_fee: "cosmetic_market_skin_sale_broker_fee";
        cosmetic_market_skin_sale_tax: "cosmetic_market_skin_sale_tax";
        cosmetic_market_skin_transaction: "cosmetic_market_skin_transaction";
        courier_mission_escrow: "courier_mission_escrow";
        cspa: "cspa";
        cspaofflinerefund: "cspaofflinerefund";
        daily_challenge_reward: "daily_challenge_reward";
        daily_goal_payouts: "daily_goal_payouts";
        daily_goal_payouts_tax: "daily_goal_payouts_tax";
        datacore_fee: "datacore_fee";
        dna_modification_fee: "dna_modification_fee";
        docking_fee: "docking_fee";
        duel_wager_escrow: "duel_wager_escrow";
        duel_wager_payment: "duel_wager_payment";
        duel_wager_refund: "duel_wager_refund";
        ess_escrow_transfer: "ess_escrow_transfer";
        external_trade_delivery: "external_trade_delivery";
        external_trade_freeze: "external_trade_freeze";
        external_trade_thaw: "external_trade_thaw";
        factory_slot_rental_fee: "factory_slot_rental_fee";
        flux_payout: "flux_payout";
        flux_tax: "flux_tax";
        flux_ticket_repayment: "flux_ticket_repayment";
        flux_ticket_sale: "flux_ticket_sale";
        freelance_jobs_broadcasting_fee: "freelance_jobs_broadcasting_fee";
        freelance_jobs_duration_fee: "freelance_jobs_duration_fee";
        freelance_jobs_escrow_refund: "freelance_jobs_escrow_refund";
        freelance_jobs_reward: "freelance_jobs_reward";
        freelance_jobs_reward_corporation_tax: "freelance_jobs_reward_corporation_tax";
        freelance_jobs_reward_escrow: "freelance_jobs_reward_escrow";
        gm_cash_transfer: "gm_cash_transfer";
        gm_plex_fee_refund: "gm_plex_fee_refund";
        industry_job_tax: "industry_job_tax";
        industry_security_tax: "industry_security_tax";
        infrastructure_hub_maintenance: "infrastructure_hub_maintenance";
        inheritance: "inheritance";
        insurance: "insurance";
        insurgency_corruption_contribution_reward: "insurgency_corruption_contribution_reward";
        insurgency_suppression_contribution_reward: "insurgency_suppression_contribution_reward";
        item_trader_payment: "item_trader_payment";
        jump_clone_activation_fee: "jump_clone_activation_fee";
        jump_clone_installation_fee: "jump_clone_installation_fee";
        kill_right_fee: "kill_right_fee";
        lp_store: "lp_store";
        manufacturing: "manufacturing";
        market_escrow: "market_escrow";
        market_fine_paid: "market_fine_paid";
        market_provider_tax: "market_provider_tax";
        market_security_tax: "market_security_tax";
        market_transaction: "market_transaction";
        medal_creation: "medal_creation";
        medal_issued: "medal_issued";
        milestone_reward_payment: "milestone_reward_payment";
        mission_completion: "mission_completion";
        mission_cost: "mission_cost";
        mission_expiration: "mission_expiration";
        mission_reward: "mission_reward";
        npc_bounty_security_tax: "npc_bounty_security_tax";
        office_rental_fee: "office_rental_fee";
        operation_bonus: "operation_bonus";
        opportunity_reward: "opportunity_reward";
        planetary_construction: "planetary_construction";
        planetary_export_tax: "planetary_export_tax";
        planetary_import_tax: "planetary_import_tax";
        player_donation: "player_donation";
        player_trading: "player_trading";
        project_discovery_reward: "project_discovery_reward";
        project_discovery_tax: "project_discovery_tax";
        project_payouts: "project_payouts";
        reaction: "reaction";
        redeemed_isk_token: "redeemed_isk_token";
        release_of_impounded_property: "release_of_impounded_property";
        repair_bill: "repair_bill";
        reprocessing_tax: "reprocessing_tax";
        researching_material_productivity: "researching_material_productivity";
        researching_technology: "researching_technology";
        researching_time_productivity: "researching_time_productivity";
        resource_wars_reward: "resource_wars_reward";
        reverse_engineering: "reverse_engineering";
        season_challenge_reward: "season_challenge_reward";
        security_processing_fee: "security_processing_fee";
        shares: "shares";
        skill_purchase: "skill_purchase";
        skyhook_claim_fee: "skyhook_claim_fee";
        sovereignity_bill: "sovereignity_bill";
        store_purchase: "store_purchase";
        store_purchase_refund: "store_purchase_refund";
        structure_gate_jump: "structure_gate_jump";
        transaction_tax: "transaction_tax";
        under_construction: "under_construction";
        upkeep_adjustment_fee: "upkeep_adjustment_fee";
        war_ally_contract: "war_ally_contract";
        war_fee: "war_fee";
        war_fee_surrender: "war_fee_surrender";
    }>;
    second_party_id: z.ZodOptional<z.ZodInt>;
    tax: z.ZodOptional<z.ZodNumber>;
    tax_receiver_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
/**
 * Wallet transactions
 */
export declare const zCharactersCharacterIdWalletTransactionsGet: z.ZodArray<z.ZodObject<{
    client_id: z.ZodInt;
    date: z.ZodISODateTime;
    is_buy: z.ZodBoolean;
    is_personal: z.ZodBoolean;
    journal_ref_id: z.ZodInt;
    location_id: z.ZodInt;
    quantity: z.ZodInt;
    transaction_id: z.ZodInt;
    type_id: z.ZodInt;
    unit_price: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCharactersCosmeticsSkinrComponentsItem: z.ZodObject<{
    component_id: z.ZodInt;
    runs: z.ZodXor<readonly [z.ZodObject<{
        remaining: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        unlimited: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>]>;
    type: z.ZodEnum<{
        nanocoating: "nanocoating";
        pattern: "pattern";
    }>;
}, z.core.$loose>;
export declare const zCharactersCosmeticsSkinrComponents: z.ZodObject<{
    licenses: z.ZodArray<z.ZodObject<{
        component_id: z.ZodInt;
        runs: z.ZodXor<readonly [z.ZodObject<{
            remaining: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            unlimited: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>]>;
        type: z.ZodEnum<{
            nanocoating: "nanocoating";
            pattern: "pattern";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersCosmeticsSkinrItem: z.ZodObject<{
    activated: z.ZodBoolean;
    skinr_id: z.ZodString;
    unactivated: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersCosmeticsSkinr: z.ZodObject<{
    licenses: z.ZodArray<z.ZodObject<{
        activated: z.ZodBoolean;
        skinr_id: z.ZodString;
        unactivated: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersFreelanceJobsParticipation: z.ZodObject<{
    contributed: z.ZodInt;
    last_modified: z.ZodISODateTime;
    state: z.ZodEnum<{
        Committed: "Committed";
        Kicked: "Kicked";
        Resigned: "Resigned";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCharactersSkillsSkill: z.ZodObject<{
    active_skill_level: z.ZodInt;
    skill_id: z.ZodInt;
    skillpoints_in_skill: z.ZodInt;
    trained_skill_level: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersSkills: z.ZodObject<{
    skills: z.ZodArray<z.ZodObject<{
        active_skill_level: z.ZodInt;
        skill_id: z.ZodInt;
        skillpoints_in_skill: z.ZodInt;
        trained_skill_level: z.ZodInt;
    }, z.core.$loose>>;
    total_sp: z.ZodInt;
    unallocated_sp: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensDetailEvolutionanarchy: z.ZodObject<{
    amount: z.ZodInt;
    level: z.ZodEnum<{
        Level0: "Level0";
        Level1: "Level1";
        Level2: "Level2";
        Level3: "Level3";
        Level4: "Level4";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensDetailEvolutiondevelopment: z.ZodObject<{
    amount: z.ZodInt;
    level: z.ZodEnum<{
        Level0: "Level0";
        Level1: "Level1";
        Level2: "Level2";
        Level3: "Level3";
        Level4: "Level4";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensDetailEvolution: z.ZodObject<{
    anarchy: z.ZodObject<{
        amount: z.ZodInt;
        level: z.ZodEnum<{
            Level0: "Level0";
            Level1: "Level1";
            Level2: "Level2";
            Level3: "Level3";
            Level4: "Level4";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>;
    development: z.ZodObject<{
        amount: z.ZodInt;
        level: z.ZodEnum<{
            Level0: "Level0";
            Level1: "Level1";
            Level2: "Level2";
            Level3: "Level3";
            Level4: "Level4";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensDetailInfomorphs: z.ZodObject<{
    amount: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensDetailReinforcementtimer: z.ZodObject<{
    end: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zCompatibilityDate: z.ZodISODate;
export declare const zConstellationId: z.ZodInt;
export declare const zContractsPublicBidsContractIdGet: z.ZodArray<z.ZodObject<{
    amount: z.ZodNumber;
    bid_id: z.ZodInt;
    date_bid: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zContractsPublicItemsContractIdGet: z.ZodArray<z.ZodObject<{
    is_blueprint_copy: z.ZodOptional<z.ZodBoolean>;
    is_included: z.ZodBoolean;
    item_id: z.ZodOptional<z.ZodInt>;
    material_efficiency: z.ZodOptional<z.ZodInt>;
    quantity: z.ZodInt;
    record_id: z.ZodInt;
    runs: z.ZodOptional<z.ZodInt>;
    time_efficiency: z.ZodOptional<z.ZodInt>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zContractsPublicRegionIdGet: z.ZodArray<z.ZodObject<{
    buyout: z.ZodOptional<z.ZodNumber>;
    collateral: z.ZodOptional<z.ZodNumber>;
    contract_id: z.ZodInt;
    date_expired: z.ZodISODateTime;
    date_issued: z.ZodISODateTime;
    days_to_complete: z.ZodOptional<z.ZodInt>;
    end_location_id: z.ZodOptional<z.ZodInt>;
    for_corporation: z.ZodOptional<z.ZodBoolean>;
    issuer_corporation_id: z.ZodInt;
    issuer_id: z.ZodInt;
    price: z.ZodOptional<z.ZodNumber>;
    reward: z.ZodOptional<z.ZodNumber>;
    start_location_id: z.ZodOptional<z.ZodInt>;
    title: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        auction: "auction";
        courier: "courier";
        item_exchange: "item_exchange";
        loan: "loan";
        unknown: "unknown";
    }>;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>>;
export declare const zCorporationCorporationIdMiningExtractionsGet: z.ZodArray<z.ZodObject<{
    chunk_arrival_time: z.ZodISODateTime;
    extraction_start_time: z.ZodISODateTime;
    moon_id: z.ZodInt;
    natural_decay_time: z.ZodISODateTime;
    structure_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationCorporationIdMiningObserversGet: z.ZodArray<z.ZodObject<{
    last_updated: z.ZodISODate;
    observer_id: z.ZodInt;
    observer_type: z.ZodEnum<{
        structure: "structure";
    }>;
}, z.core.$loose>>;
export declare const zCorporationCorporationIdMiningObserversObserverIdGet: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    last_updated: z.ZodISODate;
    quantity: z.ZodInt;
    recorded_corporation_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationId: z.ZodInt;
export declare const zCharactersAccessListsDetailCorporationentry: z.ZodObject<{
    access: z.ZodEnum<{
        Admin: "Admin";
        Allowed: "Allowed";
        Blocked: "Blocked";
        Manager: "Manager";
        Unspecified: "Unspecified";
    }>;
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersAccessListsDetailMembership: z.ZodObject<{
    alliances: z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            Admin: "Admin";
            Allowed: "Allowed";
            Blocked: "Blocked";
            Manager: "Manager";
            Unspecified: "Unspecified";
        }>;
        alliance_id: z.ZodInt;
    }, z.core.$loose>>;
    allow_everyone: z.ZodBoolean;
    characters: z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            Admin: "Admin";
            Allowed: "Allowed";
            Blocked: "Blocked";
            Manager: "Manager";
            Unspecified: "Unspecified";
        }>;
        character_id: z.ZodInt;
    }, z.core.$loose>>;
    corporations: z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            Admin: "Admin";
            Allowed: "Allowed";
            Blocked: "Blocked";
            Manager: "Manager";
            Unspecified: "Unspecified";
        }>;
        corporation_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersAccessListsDetail: z.ZodObject<{
    description: z.ZodString;
    id: z.ZodInt;
    membership: z.ZodObject<{
        alliances: z.ZodArray<z.ZodObject<{
            access: z.ZodEnum<{
                Admin: "Admin";
                Allowed: "Allowed";
                Blocked: "Blocked";
                Manager: "Manager";
                Unspecified: "Unspecified";
            }>;
            alliance_id: z.ZodInt;
        }, z.core.$loose>>;
        allow_everyone: z.ZodBoolean;
        characters: z.ZodArray<z.ZodObject<{
            access: z.ZodEnum<{
                Admin: "Admin";
                Allowed: "Allowed";
                Blocked: "Blocked";
                Manager: "Manager";
                Unspecified: "Unspecified";
            }>;
            character_id: z.ZodInt;
        }, z.core.$loose>>;
        corporations: z.ZodArray<z.ZodObject<{
            access: z.ZodEnum<{
                Admin: "Admin";
                Allowed: "Allowed";
                Blocked: "Blocked";
                Manager: "Manager";
                Unspecified: "Unspecified";
            }>;
            corporation_id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zCorporationsCorporationIdAlliancehistoryGet: z.ZodArray<z.ZodObject<{
    alliance_id: z.ZodOptional<z.ZodInt>;
    is_deleted: z.ZodOptional<z.ZodBoolean>;
    record_id: z.ZodInt;
    start_date: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdAssetsGet: z.ZodArray<z.ZodObject<{
    is_blueprint_copy: z.ZodOptional<z.ZodBoolean>;
    is_singleton: z.ZodBoolean;
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Bonus: "Bonus";
        Booster: "Booster";
        BoosterBay: "BoosterBay";
        Capsule: "Capsule";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorpDeliveries: "CorpDeliveries";
        CorpSAG1: "CorpSAG1";
        CorpSAG2: "CorpSAG2";
        CorpSAG3: "CorpSAG3";
        CorpSAG4: "CorpSAG4";
        CorpSAG5: "CorpSAG5";
        CorpSAG6: "CorpSAG6";
        CorpSAG7: "CorpSAG7";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CrateLoot: "CrateLoot";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        DustBattle: "DustBattle";
        DustDatabank: "DustDatabank";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        Impounded: "Impounded";
        InfrastructureHangar: "InfrastructureHangar";
        JunkyardReprocessed: "JunkyardReprocessed";
        JunkyardTrashed: "JunkyardTrashed";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        OfficeFolder: "OfficeFolder";
        Pilot: "Pilot";
        PlanetSurface: "PlanetSurface";
        QuafeBay: "QuafeBay";
        QuantumCoreRoom: "QuantumCoreRoom";
        Reward: "Reward";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        SecondaryStorage: "SecondaryStorage";
        ServiceSlot0: "ServiceSlot0";
        ServiceSlot1: "ServiceSlot1";
        ServiceSlot2: "ServiceSlot2";
        ServiceSlot3: "ServiceSlot3";
        ServiceSlot4: "ServiceSlot4";
        ServiceSlot5: "ServiceSlot5";
        ServiceSlot6: "ServiceSlot6";
        ServiceSlot7: "ServiceSlot7";
        ShipHangar: "ShipHangar";
        ShipOffline: "ShipOffline";
        Skill: "Skill";
        SkillInTraining: "SkillInTraining";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureActive: "StructureActive";
        StructureFuel: "StructureFuel";
        StructureInactive: "StructureInactive";
        StructureOffline: "StructureOffline";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wallet: "Wallet";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    location_type: z.ZodEnum<{
        item: "item";
        other: "other";
        solar_system: "solar_system";
        station: "station";
    }>;
    quantity: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdAssetsLocationsPost: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdAssetsNamesPost: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdBlueprintsGet: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Bonus: "Bonus";
        Booster: "Booster";
        BoosterBay: "BoosterBay";
        Capsule: "Capsule";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorpDeliveries: "CorpDeliveries";
        CorpSAG1: "CorpSAG1";
        CorpSAG2: "CorpSAG2";
        CorpSAG3: "CorpSAG3";
        CorpSAG4: "CorpSAG4";
        CorpSAG5: "CorpSAG5";
        CorpSAG6: "CorpSAG6";
        CorpSAG7: "CorpSAG7";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CrateLoot: "CrateLoot";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        DustBattle: "DustBattle";
        DustDatabank: "DustDatabank";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        Impounded: "Impounded";
        InfrastructureHangar: "InfrastructureHangar";
        JunkyardReprocessed: "JunkyardReprocessed";
        JunkyardTrashed: "JunkyardTrashed";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        OfficeFolder: "OfficeFolder";
        Pilot: "Pilot";
        PlanetSurface: "PlanetSurface";
        QuafeBay: "QuafeBay";
        QuantumCoreRoom: "QuantumCoreRoom";
        Reward: "Reward";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        SecondaryStorage: "SecondaryStorage";
        ServiceSlot0: "ServiceSlot0";
        ServiceSlot1: "ServiceSlot1";
        ServiceSlot2: "ServiceSlot2";
        ServiceSlot3: "ServiceSlot3";
        ServiceSlot4: "ServiceSlot4";
        ServiceSlot5: "ServiceSlot5";
        ServiceSlot6: "ServiceSlot6";
        ServiceSlot7: "ServiceSlot7";
        ShipHangar: "ShipHangar";
        ShipOffline: "ShipOffline";
        Skill: "Skill";
        SkillInTraining: "SkillInTraining";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureActive: "StructureActive";
        StructureFuel: "StructureFuel";
        StructureInactive: "StructureInactive";
        StructureOffline: "StructureOffline";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wallet: "Wallet";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    material_efficiency: z.ZodInt;
    quantity: z.ZodInt;
    runs: z.ZodInt;
    time_efficiency: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdContactsGet: z.ZodArray<z.ZodObject<{
    contact_id: z.ZodInt;
    contact_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
    }>;
    is_watched: z.ZodOptional<z.ZodBoolean>;
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdContactsLabelsGet: z.ZodArray<z.ZodObject<{
    label_id: z.ZodInt;
    label_name: z.ZodString;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdContainersLogsGet: z.ZodArray<z.ZodObject<{
    action: z.ZodEnum<{
        add: "add";
        assemble: "assemble";
        configure: "configure";
        enter_password: "enter_password";
        lock: "lock";
        move: "move";
        repackage: "repackage";
        set_name: "set_name";
        set_password: "set_password";
        unlock: "unlock";
    }>;
    character_id: z.ZodInt;
    container_id: z.ZodInt;
    container_type_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Bonus: "Bonus";
        Booster: "Booster";
        BoosterBay: "BoosterBay";
        Capsule: "Capsule";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorpDeliveries: "CorpDeliveries";
        CorpSAG1: "CorpSAG1";
        CorpSAG2: "CorpSAG2";
        CorpSAG3: "CorpSAG3";
        CorpSAG4: "CorpSAG4";
        CorpSAG5: "CorpSAG5";
        CorpSAG6: "CorpSAG6";
        CorpSAG7: "CorpSAG7";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CrateLoot: "CrateLoot";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        DustBattle: "DustBattle";
        DustDatabank: "DustDatabank";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        Impounded: "Impounded";
        InfrastructureHangar: "InfrastructureHangar";
        JunkyardReprocessed: "JunkyardReprocessed";
        JunkyardTrashed: "JunkyardTrashed";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        OfficeFolder: "OfficeFolder";
        Pilot: "Pilot";
        PlanetSurface: "PlanetSurface";
        QuafeBay: "QuafeBay";
        QuantumCoreRoom: "QuantumCoreRoom";
        Reward: "Reward";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        SecondaryStorage: "SecondaryStorage";
        ServiceSlot0: "ServiceSlot0";
        ServiceSlot1: "ServiceSlot1";
        ServiceSlot2: "ServiceSlot2";
        ServiceSlot3: "ServiceSlot3";
        ServiceSlot4: "ServiceSlot4";
        ServiceSlot5: "ServiceSlot5";
        ServiceSlot6: "ServiceSlot6";
        ServiceSlot7: "ServiceSlot7";
        ShipHangar: "ShipHangar";
        ShipOffline: "ShipOffline";
        Skill: "Skill";
        SkillInTraining: "SkillInTraining";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureActive: "StructureActive";
        StructureFuel: "StructureFuel";
        StructureInactive: "StructureInactive";
        StructureOffline: "StructureOffline";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wallet: "Wallet";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    logged_at: z.ZodISODateTime;
    new_config_bitmask: z.ZodOptional<z.ZodInt>;
    old_config_bitmask: z.ZodOptional<z.ZodInt>;
    password_type: z.ZodOptional<z.ZodEnum<{
        config: "config";
        general: "general";
    }>>;
    quantity: z.ZodOptional<z.ZodInt>;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdContractsContractIdBidsGet: z.ZodArray<z.ZodObject<{
    amount: z.ZodNumber;
    bid_id: z.ZodInt;
    bidder_id: z.ZodInt;
    date_bid: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdContractsContractIdItemsGet: z.ZodArray<z.ZodObject<{
    is_included: z.ZodBoolean;
    is_singleton: z.ZodBoolean;
    quantity: z.ZodInt;
    raw_quantity: z.ZodOptional<z.ZodInt>;
    record_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdContractsGet: z.ZodArray<z.ZodObject<{
    acceptor_id: z.ZodInt;
    assignee_id: z.ZodInt;
    availability: z.ZodEnum<{
        alliance: "alliance";
        corporation: "corporation";
        personal: "personal";
        public: "public";
    }>;
    buyout: z.ZodOptional<z.ZodNumber>;
    collateral: z.ZodOptional<z.ZodNumber>;
    contract_id: z.ZodInt;
    date_accepted: z.ZodOptional<z.ZodISODateTime>;
    date_completed: z.ZodOptional<z.ZodISODateTime>;
    date_expired: z.ZodISODateTime;
    date_issued: z.ZodISODateTime;
    days_to_complete: z.ZodOptional<z.ZodInt>;
    end_location_id: z.ZodOptional<z.ZodInt>;
    for_corporation: z.ZodBoolean;
    issuer_corporation_id: z.ZodInt;
    issuer_id: z.ZodInt;
    price: z.ZodOptional<z.ZodNumber>;
    reward: z.ZodOptional<z.ZodNumber>;
    start_location_id: z.ZodOptional<z.ZodInt>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        deleted: "deleted";
        failed: "failed";
        finished: "finished";
        finished_contractor: "finished_contractor";
        finished_issuer: "finished_issuer";
        in_progress: "in_progress";
        outstanding: "outstanding";
        rejected: "rejected";
        reversed: "reversed";
    }>;
    title: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        auction: "auction";
        courier: "courier";
        item_exchange: "item_exchange";
        loan: "loan";
        unknown: "unknown";
    }>;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdCustomsOfficesGet: z.ZodArray<z.ZodObject<{
    alliance_tax_rate: z.ZodOptional<z.ZodNumber>;
    allow_access_with_standings: z.ZodBoolean;
    allow_alliance_access: z.ZodBoolean;
    bad_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    corporation_tax_rate: z.ZodOptional<z.ZodNumber>;
    excellent_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    good_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    neutral_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    office_id: z.ZodInt;
    reinforce_exit_end: z.ZodInt;
    reinforce_exit_start: z.ZodInt;
    standing_level: z.ZodOptional<z.ZodEnum<{
        bad: "bad";
        excellent: "excellent";
        good: "good";
        neutral: "neutral";
        terrible: "terrible";
    }>>;
    system_id: z.ZodInt;
    terrible_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdDivisionsGet: z.ZodObject<{
    hangar: z.ZodOptional<z.ZodArray<z.ZodObject<{
        division: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    wallet: z.ZodOptional<z.ZodArray<z.ZodObject<{
        division: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const zCorporationsCorporationIdFacilitiesGet: z.ZodArray<z.ZodObject<{
    facility_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdFwStatsGet: z.ZodObject<{
    enlisted_on: z.ZodOptional<z.ZodISODateTime>;
    faction_id: z.ZodOptional<z.ZodInt>;
    kills: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
    pilots: z.ZodOptional<z.ZodInt>;
    victory_points: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCorporationsCorporationIdIconsGet: z.ZodObject<{
    px128x128: z.ZodOptional<z.ZodString>;
    px256x256: z.ZodOptional<z.ZodString>;
    px64x64: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zCorporationsCorporationIdIndustryJobsGet: z.ZodArray<z.ZodObject<{
    activity_id: z.ZodInt;
    blueprint_id: z.ZodInt;
    blueprint_location_id: z.ZodInt;
    blueprint_type_id: z.ZodInt;
    completed_character_id: z.ZodOptional<z.ZodInt>;
    completed_date: z.ZodOptional<z.ZodISODateTime>;
    cost: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodInt;
    end_date: z.ZodISODateTime;
    facility_id: z.ZodInt;
    installer_id: z.ZodInt;
    job_id: z.ZodInt;
    licensed_runs: z.ZodOptional<z.ZodInt>;
    location_id: z.ZodInt;
    output_location_id: z.ZodInt;
    pause_date: z.ZodOptional<z.ZodISODateTime>;
    probability: z.ZodOptional<z.ZodNumber>;
    product_type_id: z.ZodOptional<z.ZodInt>;
    runs: z.ZodInt;
    start_date: z.ZodISODateTime;
    status: z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        delivered: "delivered";
        paused: "paused";
        ready: "ready";
        reverted: "reverted";
    }>;
    successful_runs: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdKillmailsRecentGet: z.ZodArray<z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdMedalsGet: z.ZodArray<z.ZodObject<{
    created_at: z.ZodISODateTime;
    creator_id: z.ZodInt;
    description: z.ZodString;
    medal_id: z.ZodInt;
    title: z.ZodString;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdMedalsIssuedGet: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    issued_at: z.ZodISODateTime;
    issuer_id: z.ZodInt;
    medal_id: z.ZodInt;
    reason: z.ZodString;
    status: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
}, z.core.$loose>>;
/**
 * A list of character IDs
 */
export declare const zCorporationsCorporationIdMembersGet: z.ZodArray<z.ZodInt>;
export declare const zCorporationsCorporationIdMembersLimitGet: z.ZodInt;
export declare const zCorporationsCorporationIdMembersTitlesGet: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    titles: z.ZodArray<z.ZodInt>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdMembertrackingGet: z.ZodArray<z.ZodObject<{
    base_id: z.ZodOptional<z.ZodInt>;
    character_id: z.ZodInt;
    location_id: z.ZodOptional<z.ZodInt>;
    logoff_date: z.ZodOptional<z.ZodISODateTime>;
    logon_date: z.ZodOptional<z.ZodISODateTime>;
    ship_type_id: z.ZodOptional<z.ZodInt>;
    start_date: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdOrdersGet: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    issued: z.ZodISODateTime;
    issued_by: z.ZodInt;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
    wallet_division: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdOrdersHistoryGet: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    issued: z.ZodISODateTime;
    issued_by: z.ZodOptional<z.ZodInt>;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    state: z.ZodEnum<{
        cancelled: "cancelled";
        expired: "expired";
    }>;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
    wallet_division: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdRolesGet: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    grantable_roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdRolesHistoryGet: z.ZodArray<z.ZodObject<{
    changed_at: z.ZodISODateTime;
    character_id: z.ZodInt;
    issuer_id: z.ZodInt;
    new_roles: z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>;
    old_roles: z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>;
    role_type: z.ZodEnum<{
        grantable_roles: "grantable_roles";
        grantable_roles_at_base: "grantable_roles_at_base";
        grantable_roles_at_hq: "grantable_roles_at_hq";
        grantable_roles_at_other: "grantable_roles_at_other";
        roles: "roles";
        roles_at_base: "roles_at_base";
        roles_at_hq: "roles_at_hq";
        roles_at_other: "roles_at_other";
    }>;
}, z.core.$loose>>;
/**
 * List of shareholders
 */
export declare const zCorporationsCorporationIdShareholdersGet: z.ZodArray<z.ZodObject<{
    share_count: z.ZodInt;
    shareholder_id: z.ZodInt;
    shareholder_type: z.ZodEnum<{
        character: "character";
        corporation: "corporation";
    }>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdStandingsGet: z.ZodArray<z.ZodObject<{
    from_id: z.ZodInt;
    from_type: z.ZodEnum<{
        agent: "agent";
        faction: "faction";
        npc_corp: "npc_corp";
    }>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdStarbasesGet: z.ZodArray<z.ZodObject<{
    moon_id: z.ZodOptional<z.ZodInt>;
    onlined_since: z.ZodOptional<z.ZodISODateTime>;
    reinforced_until: z.ZodOptional<z.ZodISODateTime>;
    starbase_id: z.ZodInt;
    state: z.ZodOptional<z.ZodEnum<{
        offline: "offline";
        online: "online";
        onlining: "onlining";
        reinforced: "reinforced";
        unanchoring: "unanchoring";
    }>>;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
    unanchor_at: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdStarbasesStarbaseIdGet: z.ZodObject<{
    allow_alliance_members: z.ZodBoolean;
    allow_corporation_members: z.ZodBoolean;
    anchor: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    attack_if_at_war: z.ZodBoolean;
    attack_if_other_security_status_dropping: z.ZodBoolean;
    attack_security_status_threshold: z.ZodOptional<z.ZodNumber>;
    attack_standing_threshold: z.ZodOptional<z.ZodNumber>;
    fuel_bay_take: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    fuel_bay_view: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    fuels: z.ZodOptional<z.ZodArray<z.ZodObject<{
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>>;
    offline: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    online: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    unanchor: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    use_alliance_standings: z.ZodBoolean;
}, z.core.$loose>;
export declare const zCorporationsCorporationIdStructuresGet: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    fuel_expires: z.ZodOptional<z.ZodISODateTime>;
    name: z.ZodOptional<z.ZodString>;
    next_reinforce_apply: z.ZodOptional<z.ZodISODateTime>;
    next_reinforce_hour: z.ZodOptional<z.ZodInt>;
    profile_id: z.ZodInt;
    reinforce_hour: z.ZodOptional<z.ZodInt>;
    services: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        state: z.ZodEnum<{
            cleanup: "cleanup";
            offline: "offline";
            online: "online";
        }>;
    }, z.core.$loose>>>;
    state: z.ZodEnum<{
        anchor_vulnerable: "anchor_vulnerable";
        anchoring: "anchoring";
        armor_reinforce: "armor_reinforce";
        armor_vulnerable: "armor_vulnerable";
        deploy_vulnerable: "deploy_vulnerable";
        fitting_invulnerable: "fitting_invulnerable";
        hull_reinforce: "hull_reinforce";
        hull_vulnerable: "hull_vulnerable";
        online_deprecated: "online_deprecated";
        onlining_vulnerable: "onlining_vulnerable";
        shield_vulnerable: "shield_vulnerable";
        unanchored: "unanchored";
        unknown: "unknown";
    }>;
    state_timer_end: z.ZodOptional<z.ZodISODateTime>;
    state_timer_start: z.ZodOptional<z.ZodISODateTime>;
    structure_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
    unanchors_at: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdTitlesGet: z.ZodArray<z.ZodObject<{
    grantable_roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    name: z.ZodOptional<z.ZodString>;
    roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    title_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
/**
 * Journal entries
 */
export declare const zCorporationsCorporationIdWalletsDivisionJournalGet: z.ZodArray<z.ZodObject<{
    amount: z.ZodOptional<z.ZodNumber>;
    balance: z.ZodOptional<z.ZodNumber>;
    context_id: z.ZodOptional<z.ZodInt>;
    context_id_type: z.ZodOptional<z.ZodEnum<{
        alliance_id: "alliance_id";
        character_id: "character_id";
        contract_id: "contract_id";
        corporation_id: "corporation_id";
        eve_system: "eve_system";
        industry_job_id: "industry_job_id";
        market_transaction_id: "market_transaction_id";
        planet_id: "planet_id";
        station_id: "station_id";
        structure_id: "structure_id";
        system_id: "system_id";
        type_id: "type_id";
    }>>;
    date: z.ZodISODateTime;
    description: z.ZodString;
    first_party_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    reason: z.ZodOptional<z.ZodString>;
    ref_type: z.ZodEnum<{
        acceleration_gate_fee: "acceleration_gate_fee";
        achievement_category_milestone_reward: "achievement_category_milestone_reward";
        achievement_milestone_reward: "achievement_milestone_reward";
        advertisement_listing_fee: "advertisement_listing_fee";
        agent_donation: "agent_donation";
        agent_location_services: "agent_location_services";
        agent_miscellaneous: "agent_miscellaneous";
        agent_mission_collateral_paid: "agent_mission_collateral_paid";
        agent_mission_collateral_refunded: "agent_mission_collateral_refunded";
        agent_mission_reward: "agent_mission_reward";
        agent_mission_reward_corporation_tax: "agent_mission_reward_corporation_tax";
        agent_mission_security_tax: "agent_mission_security_tax";
        agent_mission_time_bonus_reward: "agent_mission_time_bonus_reward";
        agent_mission_time_bonus_reward_corporation_tax: "agent_mission_time_bonus_reward_corporation_tax";
        agent_security_services: "agent_security_services";
        agent_services_rendered: "agent_services_rendered";
        agents_preward: "agents_preward";
        air_career_program_reward: "air_career_program_reward";
        alliance_maintainance_fee: "alliance_maintainance_fee";
        alliance_registration_fee: "alliance_registration_fee";
        allignment_based_gate_toll: "allignment_based_gate_toll";
        asset_safety_recovery_tax: "asset_safety_recovery_tax";
        bounty: "bounty";
        bounty_prize: "bounty_prize";
        bounty_prize_corporation_tax: "bounty_prize_corporation_tax";
        bounty_prizes: "bounty_prizes";
        bounty_reimbursement: "bounty_reimbursement";
        bounty_surcharge: "bounty_surcharge";
        brokers_fee: "brokers_fee";
        campaign_objective_isk_reward: "campaign_objective_isk_reward";
        clone_activation: "clone_activation";
        clone_transfer: "clone_transfer";
        contraband_fine: "contraband_fine";
        contract_auction_bid: "contract_auction_bid";
        contract_auction_bid_corp: "contract_auction_bid_corp";
        contract_auction_bid_refund: "contract_auction_bid_refund";
        contract_auction_sold: "contract_auction_sold";
        contract_brokers_fee: "contract_brokers_fee";
        contract_brokers_fee_corp: "contract_brokers_fee_corp";
        contract_collateral: "contract_collateral";
        contract_collateral_deposited_corp: "contract_collateral_deposited_corp";
        contract_collateral_payout: "contract_collateral_payout";
        contract_collateral_refund: "contract_collateral_refund";
        contract_deposit: "contract_deposit";
        contract_deposit_corp: "contract_deposit_corp";
        contract_deposit_refund: "contract_deposit_refund";
        contract_deposit_sales_tax: "contract_deposit_sales_tax";
        contract_price: "contract_price";
        contract_price_payment_corp: "contract_price_payment_corp";
        contract_reversal: "contract_reversal";
        contract_reward: "contract_reward";
        contract_reward_deposited: "contract_reward_deposited";
        contract_reward_deposited_corp: "contract_reward_deposited_corp";
        contract_reward_refund: "contract_reward_refund";
        contract_sales_tax: "contract_sales_tax";
        copying: "copying";
        corporate_reward_payout: "corporate_reward_payout";
        corporate_reward_tax: "corporate_reward_tax";
        corporation_account_withdrawal: "corporation_account_withdrawal";
        corporation_bulk_payment: "corporation_bulk_payment";
        corporation_dividend_payment: "corporation_dividend_payment";
        corporation_liquidation: "corporation_liquidation";
        corporation_logo_change_cost: "corporation_logo_change_cost";
        corporation_payment: "corporation_payment";
        corporation_registration_fee: "corporation_registration_fee";
        cosmetic_market_component_item_purchase: "cosmetic_market_component_item_purchase";
        cosmetic_market_skin_purchase: "cosmetic_market_skin_purchase";
        cosmetic_market_skin_sale: "cosmetic_market_skin_sale";
        cosmetic_market_skin_sale_broker_fee: "cosmetic_market_skin_sale_broker_fee";
        cosmetic_market_skin_sale_tax: "cosmetic_market_skin_sale_tax";
        cosmetic_market_skin_transaction: "cosmetic_market_skin_transaction";
        courier_mission_escrow: "courier_mission_escrow";
        cspa: "cspa";
        cspaofflinerefund: "cspaofflinerefund";
        daily_challenge_reward: "daily_challenge_reward";
        daily_goal_payouts: "daily_goal_payouts";
        daily_goal_payouts_tax: "daily_goal_payouts_tax";
        datacore_fee: "datacore_fee";
        dna_modification_fee: "dna_modification_fee";
        docking_fee: "docking_fee";
        duel_wager_escrow: "duel_wager_escrow";
        duel_wager_payment: "duel_wager_payment";
        duel_wager_refund: "duel_wager_refund";
        ess_escrow_transfer: "ess_escrow_transfer";
        external_trade_delivery: "external_trade_delivery";
        external_trade_freeze: "external_trade_freeze";
        external_trade_thaw: "external_trade_thaw";
        factory_slot_rental_fee: "factory_slot_rental_fee";
        flux_payout: "flux_payout";
        flux_tax: "flux_tax";
        flux_ticket_repayment: "flux_ticket_repayment";
        flux_ticket_sale: "flux_ticket_sale";
        freelance_jobs_broadcasting_fee: "freelance_jobs_broadcasting_fee";
        freelance_jobs_duration_fee: "freelance_jobs_duration_fee";
        freelance_jobs_escrow_refund: "freelance_jobs_escrow_refund";
        freelance_jobs_reward: "freelance_jobs_reward";
        freelance_jobs_reward_corporation_tax: "freelance_jobs_reward_corporation_tax";
        freelance_jobs_reward_escrow: "freelance_jobs_reward_escrow";
        gm_cash_transfer: "gm_cash_transfer";
        gm_plex_fee_refund: "gm_plex_fee_refund";
        industry_job_tax: "industry_job_tax";
        industry_security_tax: "industry_security_tax";
        infrastructure_hub_maintenance: "infrastructure_hub_maintenance";
        inheritance: "inheritance";
        insurance: "insurance";
        insurgency_corruption_contribution_reward: "insurgency_corruption_contribution_reward";
        insurgency_suppression_contribution_reward: "insurgency_suppression_contribution_reward";
        item_trader_payment: "item_trader_payment";
        jump_clone_activation_fee: "jump_clone_activation_fee";
        jump_clone_installation_fee: "jump_clone_installation_fee";
        kill_right_fee: "kill_right_fee";
        lp_store: "lp_store";
        manufacturing: "manufacturing";
        market_escrow: "market_escrow";
        market_fine_paid: "market_fine_paid";
        market_provider_tax: "market_provider_tax";
        market_security_tax: "market_security_tax";
        market_transaction: "market_transaction";
        medal_creation: "medal_creation";
        medal_issued: "medal_issued";
        milestone_reward_payment: "milestone_reward_payment";
        mission_completion: "mission_completion";
        mission_cost: "mission_cost";
        mission_expiration: "mission_expiration";
        mission_reward: "mission_reward";
        npc_bounty_security_tax: "npc_bounty_security_tax";
        office_rental_fee: "office_rental_fee";
        operation_bonus: "operation_bonus";
        opportunity_reward: "opportunity_reward";
        planetary_construction: "planetary_construction";
        planetary_export_tax: "planetary_export_tax";
        planetary_import_tax: "planetary_import_tax";
        player_donation: "player_donation";
        player_trading: "player_trading";
        project_discovery_reward: "project_discovery_reward";
        project_discovery_tax: "project_discovery_tax";
        project_payouts: "project_payouts";
        reaction: "reaction";
        redeemed_isk_token: "redeemed_isk_token";
        release_of_impounded_property: "release_of_impounded_property";
        repair_bill: "repair_bill";
        reprocessing_tax: "reprocessing_tax";
        researching_material_productivity: "researching_material_productivity";
        researching_technology: "researching_technology";
        researching_time_productivity: "researching_time_productivity";
        resource_wars_reward: "resource_wars_reward";
        reverse_engineering: "reverse_engineering";
        season_challenge_reward: "season_challenge_reward";
        security_processing_fee: "security_processing_fee";
        shares: "shares";
        skill_purchase: "skill_purchase";
        skyhook_claim_fee: "skyhook_claim_fee";
        sovereignity_bill: "sovereignity_bill";
        store_purchase: "store_purchase";
        store_purchase_refund: "store_purchase_refund";
        structure_gate_jump: "structure_gate_jump";
        transaction_tax: "transaction_tax";
        under_construction: "under_construction";
        upkeep_adjustment_fee: "upkeep_adjustment_fee";
        war_ally_contract: "war_ally_contract";
        war_fee: "war_fee";
        war_fee_surrender: "war_fee_surrender";
    }>;
    second_party_id: z.ZodOptional<z.ZodInt>;
    tax: z.ZodOptional<z.ZodNumber>;
    tax_receiver_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
/**
 * Wallet transactions
 */
export declare const zCorporationsCorporationIdWalletsDivisionTransactionsGet: z.ZodArray<z.ZodObject<{
    client_id: z.ZodInt;
    date: z.ZodISODateTime;
    is_buy: z.ZodBoolean;
    journal_ref_id: z.ZodInt;
    location_id: z.ZodInt;
    quantity: z.ZodInt;
    transaction_id: z.ZodInt;
    type_id: z.ZodInt;
    unit_price: z.ZodNumber;
}, z.core.$loose>>;
export declare const zCorporationsCorporationIdWalletsGet: z.ZodArray<z.ZodObject<{
    balance: z.ZodNumber;
    division: z.ZodInt;
}, z.core.$loose>>;
export declare const zCorporationsDetailPalette: z.ZodObject<{
    main_color: z.ZodString;
    secondary_color: z.ZodOptional<z.ZodString>;
    tertiary_color: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zCorporationsDetailTaxrates: z.ZodObject<{
    isk: z.ZodNumber;
    loyalty_point: z.ZodNumber;
}, z.core.$loose>;
export declare const zCorporationsFreelanceJobsParticipantsParticipant: z.ZodObject<{
    contributed: z.ZodInt;
    id: z.ZodInt;
    name: z.ZodString;
    state: z.ZodEnum<{
        Committed: "Committed";
        Kicked: "Kicked";
        Resigned: "Resigned";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCorporationsNpccorpsGet: z.ZodArray<z.ZodInt>;
export declare const zCorporationsProjectsContribution: z.ZodObject<{
    contributed: z.ZodInt;
    last_modified: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zCorporationsProjectsContributorsContributor: z.ZodObject<{
    contributed: z.ZodInt;
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationmanual: z.ZodObject<{}, z.core.$catchall<z.ZodUnknown>>;
export declare const zCorporationsProjectsDetailConfigurationmatcherarchetype: z.ZodObject<{
    archetype_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationmatchercorporation: z.ZodObject<{
    corporation_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationearnloyaltypoints: z.ZodObject<{
    corporations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationmatchersignature: z.ZodObject<{
    signature_type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationunknown: z.ZodObject<{
    data: z.ZodUnknown;
    type: z.ZodString;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailContribution: z.ZodObject<{
    participation_limit: z.ZodOptional<z.ZodInt>;
    reward_per_contribution: z.ZodOptional<z.ZodNumber>;
    submission_limit: z.ZodOptional<z.ZodInt>;
    submission_multiplier: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailCreator: z.ZodObject<{
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailDetails: z.ZodObject<{
    career: z.ZodEnum<{
        Enforcer: "Enforcer";
        Explorer: "Explorer";
        Industrialist: "Industrialist";
        "Soldier of Fortune": "Soldier of Fortune";
        Unspecified: "Unspecified";
    }>;
    created: z.ZodISODateTime;
    description: z.ZodString;
    expires: z.ZodOptional<z.ZodISODateTime>;
    finished: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailProgress: z.ZodObject<{
    current: z.ZodInt;
    desired: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailReward: z.ZodObject<{
    initial: z.ZodNumber;
    remaining: z.ZodNumber;
}, z.core.$loose>;
export declare const zCorporationsStructuresSkyhooksDetailReinforcementtimer: z.ZodObject<{
    end: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zCorporationsStructuresSkyhooksDetailTheftvulnerability: z.ZodObject<{
    end: z.ZodISODateTime;
    start: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailResourcepower: z.ZodObject<{
    allocated: z.ZodInt;
    available: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailResourceworkforce: z.ZodObject<{
    allocated: z.ZodInt;
    available: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailResources: z.ZodObject<{
    power: z.ZodObject<{
        allocated: z.ZodInt;
        available: z.ZodInt;
    }, z.core.$loose>;
    workforce: z.ZodObject<{
        allocated: z.ZodInt;
        available: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailVulnerabilitywindow: z.ZodObject<{
    end: z.ZodISODateTime;
    start: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zCosmeticsSkinrPatternprojection: z.ZodObject<{
    slot1: z.ZodBoolean;
    slot2: z.ZodBoolean;
    slot3: z.ZodBoolean;
    slot4: z.ZodBoolean;
}, z.core.$loose>;
export declare const zCosmeticsSkinrSlotnanocoating: z.ZodObject<{
    id: z.ZodInt;
}, z.core.$loose>;
export declare const zCosmeticsSkinrTier: z.ZodObject<{
    level: z.ZodInt;
}, z.core.$loose>;
export declare const zCosmeticsSkinrVector3: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
}, z.core.$loose>;
export declare const zCosmeticsSkinrVector4: z.ZodObject<{
    w: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
}, z.core.$loose>;
export declare const zCosmeticsSkinrPatterntransform: z.ZodObject<{
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    rotation: z.ZodObject<{
        w: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    scaling: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCosmeticsSkinrPatternconfiguration: z.ZodObject<{
    mirrored: z.ZodBoolean;
    projection: z.ZodObject<{
        slot1: z.ZodBoolean;
        slot2: z.ZodBoolean;
        slot3: z.ZodBoolean;
        slot4: z.ZodBoolean;
    }, z.core.$loose>;
    transform: z.ZodObject<{
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, z.core.$loose>;
        rotation: z.ZodObject<{
            w: z.ZodNumber;
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, z.core.$loose>;
        scaling: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, z.core.$loose>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCosmeticsSkinrSlotpattern: z.ZodObject<{
    configuration: z.ZodObject<{
        mirrored: z.ZodBoolean;
        projection: z.ZodObject<{
            slot1: z.ZodBoolean;
            slot2: z.ZodBoolean;
            slot3: z.ZodBoolean;
            slot4: z.ZodBoolean;
        }, z.core.$loose>;
        transform: z.ZodObject<{
            position: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                z: z.ZodNumber;
            }, z.core.$loose>;
            rotation: z.ZodObject<{
                w: z.ZodNumber;
                x: z.ZodNumber;
                y: z.ZodNumber;
                z: z.ZodNumber;
            }, z.core.$loose>;
            scaling: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                z: z.ZodNumber;
            }, z.core.$loose>;
        }, z.core.$loose>;
    }, z.core.$loose>;
    id: z.ZodInt;
}, z.core.$loose>;
export declare const zCosmeticsSkinrLayoutslot: z.ZodObject<{
    configuration: z.ZodXor<readonly [z.ZodObject<{
        nanocoating: z.ZodOptional<z.ZodObject<{
            id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        pattern: z.ZodOptional<z.ZodObject<{
            configuration: z.ZodObject<{
                mirrored: z.ZodBoolean;
                projection: z.ZodObject<{
                    slot1: z.ZodBoolean;
                    slot2: z.ZodBoolean;
                    slot3: z.ZodBoolean;
                    slot4: z.ZodBoolean;
                }, z.core.$loose>;
                transform: z.ZodObject<{
                    position: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        z: z.ZodNumber;
                    }, z.core.$loose>;
                    rotation: z.ZodObject<{
                        w: z.ZodNumber;
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        z: z.ZodNumber;
                    }, z.core.$loose>;
                    scaling: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        z: z.ZodNumber;
                    }, z.core.$loose>;
                }, z.core.$loose>;
            }, z.core.$loose>;
            id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>]>;
    id: z.ZodInt;
}, z.core.$loose>;
export declare const zCosmeticsSkinrLayout: z.ZodObject<{
    pattern_blend_mode: z.ZodEnum<{
        exclusion: "exclusion";
        nested: "nested";
        nested_inverted: "nested_inverted";
        normal: "normal";
        subtract: "subtract";
    }>;
    slots: z.ZodArray<z.ZodObject<{
        configuration: z.ZodXor<readonly [z.ZodObject<{
            nanocoating: z.ZodOptional<z.ZodObject<{
                id: z.ZodInt;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            pattern: z.ZodOptional<z.ZodObject<{
                configuration: z.ZodObject<{
                    mirrored: z.ZodBoolean;
                    projection: z.ZodObject<{
                        slot1: z.ZodBoolean;
                        slot2: z.ZodBoolean;
                        slot3: z.ZodBoolean;
                        slot4: z.ZodBoolean;
                    }, z.core.$loose>;
                    transform: z.ZodObject<{
                        position: z.ZodObject<{
                            x: z.ZodNumber;
                            y: z.ZodNumber;
                            z: z.ZodNumber;
                        }, z.core.$loose>;
                        rotation: z.ZodObject<{
                            w: z.ZodNumber;
                            x: z.ZodNumber;
                            y: z.ZodNumber;
                            z: z.ZodNumber;
                        }, z.core.$loose>;
                        scaling: z.ZodObject<{
                            x: z.ZodNumber;
                            y: z.ZodNumber;
                            z: z.ZodNumber;
                        }, z.core.$loose>;
                    }, z.core.$loose>;
                }, z.core.$loose>;
                id: z.ZodInt;
            }, z.core.$loose>>;
        }, z.core.$loose>]>;
        id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCursor: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zCorporationsFreelanceJobsParticipants: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    participants: z.ZodArray<z.ZodObject<{
        contributed: z.ZodInt;
        id: z.ZodInt;
        name: z.ZodString;
        state: z.ZodEnum<{
            Committed: "Committed";
            Kicked: "Kicked";
            Resigned: "Resigned";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsContributors: z.ZodObject<{
    contributors: z.ZodArray<z.ZodObject<{
        contributed: z.ZodInt;
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>>;
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zDogmaAttributesAttributeIdGet: z.ZodObject<{
    attribute_id: z.ZodInt;
    default_value: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    display_name: z.ZodOptional<z.ZodString>;
    high_is_good: z.ZodOptional<z.ZodBoolean>;
    icon_id: z.ZodOptional<z.ZodInt>;
    name: z.ZodOptional<z.ZodString>;
    published: z.ZodOptional<z.ZodBoolean>;
    stackable: z.ZodOptional<z.ZodBoolean>;
    unit_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zDogmaAttributesGet: z.ZodArray<z.ZodInt>;
export declare const zDogmaDynamicItemsTypeIdItemIdGet: z.ZodObject<{
    created_by: z.ZodInt;
    dogma_attributes: z.ZodArray<z.ZodObject<{
        attribute_id: z.ZodInt;
        value: z.ZodNumber;
    }, z.core.$loose>>;
    dogma_effects: z.ZodArray<z.ZodObject<{
        effect_id: z.ZodInt;
        is_default: z.ZodBoolean;
    }, z.core.$loose>>;
    mutator_type_id: z.ZodInt;
    source_type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zDogmaEffectsEffectIdGet: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    disallow_auto_repeat: z.ZodOptional<z.ZodBoolean>;
    discharge_attribute_id: z.ZodOptional<z.ZodInt>;
    display_name: z.ZodOptional<z.ZodString>;
    duration_attribute_id: z.ZodOptional<z.ZodInt>;
    effect_category: z.ZodOptional<z.ZodInt>;
    effect_id: z.ZodInt;
    electronic_chance: z.ZodOptional<z.ZodBoolean>;
    falloff_attribute_id: z.ZodOptional<z.ZodInt>;
    icon_id: z.ZodOptional<z.ZodInt>;
    is_assistance: z.ZodOptional<z.ZodBoolean>;
    is_offensive: z.ZodOptional<z.ZodBoolean>;
    is_warp_safe: z.ZodOptional<z.ZodBoolean>;
    modifiers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        domain: z.ZodOptional<z.ZodString>;
        effect_id: z.ZodOptional<z.ZodInt>;
        func: z.ZodString;
        modified_attribute_id: z.ZodOptional<z.ZodInt>;
        modifying_attribute_id: z.ZodOptional<z.ZodInt>;
        operator: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    name: z.ZodOptional<z.ZodString>;
    post_expression: z.ZodOptional<z.ZodInt>;
    pre_expression: z.ZodOptional<z.ZodInt>;
    published: z.ZodOptional<z.ZodBoolean>;
    range_attribute_id: z.ZodOptional<z.ZodInt>;
    range_chance: z.ZodOptional<z.ZodBoolean>;
    tracking_speed_attribute_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zDogmaEffectsGet: z.ZodArray<z.ZodInt>;
export declare const zDungeonId: z.ZodInt;
export declare const zErrorDetail: z.ZodObject<{
    location: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    value: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>;
export declare const zError: z.ZodObject<{
    details: z.ZodOptional<z.ZodArray<z.ZodObject<{
        location: z.ZodOptional<z.ZodString>;
        message: z.ZodOptional<z.ZodString>;
        value: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>>>;
    error: z.ZodString;
    status: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zFactionId: z.ZodInt;
export declare const zAllianceDetail: z.ZodObject<{
    creator_corporation_id: z.ZodInt;
    creator_id: z.ZodInt;
    date_founded: z.ZodISODateTime;
    executor_corporation_id: z.ZodOptional<z.ZodInt>;
    faction_id: z.ZodOptional<z.ZodInt>;
    name: z.ZodString;
    ticker: z.ZodString;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationmatcherfaction: z.ZodObject<{
    faction_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zFleetsFleetIdGet: z.ZodObject<{
    is_free_move: z.ZodBoolean;
    is_registered: z.ZodBoolean;
    is_voice_enabled: z.ZodBoolean;
    motd: z.ZodString;
}, z.core.$loose>;
export declare const zFleetsFleetIdMembersGet: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    join_time: z.ZodISODateTime;
    role: z.ZodEnum<{
        fleet_commander: "fleet_commander";
        squad_commander: "squad_commander";
        squad_member: "squad_member";
        wing_commander: "wing_commander";
    }>;
    role_name: z.ZodString;
    ship_type_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    squad_id: z.ZodInt;
    station_id: z.ZodOptional<z.ZodInt>;
    takes_fleet_warp: z.ZodBoolean;
    wing_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zFleetsFleetIdWingsGet: z.ZodArray<z.ZodObject<{
    id: z.ZodInt;
    name: z.ZodString;
    squads: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>>;
}, z.core.$loose>>;
/**
 * 201 created object
 */
export declare const zFleetsFleetIdWingsPost: z.ZodObject<{
    wing_id: z.ZodInt;
}, z.core.$loose>;
/**
 * 201 created object
 */
export declare const zFleetsFleetIdWingsWingIdSquadsPost: z.ZodObject<{
    squad_id: z.ZodInt;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailContribution: z.ZodObject<{
    contribution_per_participant_limit: z.ZodOptional<z.ZodInt>;
    max_committed_participants: z.ZodInt;
    reward_per_contribution: z.ZodOptional<z.ZodNumber>;
    submission_limit: z.ZodOptional<z.ZodInt>;
    submission_multiplier: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailCreatorcharacter: z.ZodObject<{
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailCreatorcorporation: z.ZodObject<{
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailCreator: z.ZodObject<{
    character: z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>;
    corporation: z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailDetails: z.ZodObject<{
    career: z.ZodEnum<{
        Enforcer: "Enforcer";
        Explorer: "Explorer";
        Industrialist: "Industrialist";
        "Soldier of Fortune": "Soldier of Fortune";
        Unspecified: "Unspecified";
    }>;
    created: z.ZodISODateTime;
    creator: z.ZodObject<{
        character: z.ZodObject<{
            id: z.ZodInt;
            name: z.ZodString;
        }, z.core.$loose>;
        corporation: z.ZodObject<{
            id: z.ZodInt;
            name: z.ZodString;
        }, z.core.$loose>;
    }, z.core.$loose>;
    description: z.ZodString;
    expires: z.ZodOptional<z.ZodISODateTime>;
    finished: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailParameterboolean: z.ZodObject<{
    value: z.ZodBoolean;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailParametermatchervalue: z.ZodObject<{
    value_type: z.ZodString;
    values: z.ZodArray<z.ZodString>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailParametermatcher: z.ZodObject<{
    values: z.ZodArray<z.ZodObject<{
        value_type: z.ZodString;
        values: z.ZodArray<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailParametercorporationitemdelivery: z.ZodObject<{
    corporation_office_location: z.ZodObject<{
        values: z.ZodArray<z.ZodObject<{
            value_type: z.ZodString;
            values: z.ZodArray<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    item_type: z.ZodObject<{
        values: z.ZodArray<z.ZodObject<{
            value_type: z.ZodString;
            values: z.ZodArray<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailParameteroptions: z.ZodObject<{
    selected: z.ZodArray<z.ZodString>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailConfiguration: z.ZodObject<{
    method: z.ZodString;
    parameters: z.ZodObject<{}, z.core.$catchall<z.ZodXor<readonly [z.ZodObject<{
        matcher: z.ZodOptional<z.ZodObject<{
            values: z.ZodArray<z.ZodObject<{
                value_type: z.ZodString;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        options: z.ZodOptional<z.ZodObject<{
            selected: z.ZodArray<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        boolean: z.ZodOptional<z.ZodObject<{
            value: z.ZodBoolean;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_item_delivery: z.ZodOptional<z.ZodObject<{
            corporation_office_location: z.ZodObject<{
                values: z.ZodArray<z.ZodObject<{
                    value_type: z.ZodString;
                    values: z.ZodArray<z.ZodString>;
                }, z.core.$loose>>;
            }, z.core.$loose>;
            item_type: z.ZodObject<{
                values: z.ZodArray<z.ZodObject<{
                    value_type: z.ZodString;
                    values: z.ZodArray<z.ZodString>;
                }, z.core.$loose>>;
            }, z.core.$loose>;
        }, z.core.$loose>>;
    }, z.core.$loose>]>>>;
    version: z.ZodInt;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailProgress: z.ZodObject<{
    current: z.ZodInt;
    desired: z.ZodInt;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailRestrictions: z.ZodObject<{
    maximum_age: z.ZodOptional<z.ZodInt>;
    minimum_age: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailReward: z.ZodObject<{
    initial: z.ZodNumber;
    remaining: z.ZodNumber;
}, z.core.$loose>;
export declare const zFwLeaderboardsCharactersGet: z.ZodObject<{
    kills: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zFwLeaderboardsCorporationsGet: z.ZodObject<{
    kills: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zFwLeaderboardsGet: z.ZodObject<{
    kills: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zFwStatsGet: z.ZodArray<z.ZodObject<{
    faction_id: z.ZodInt;
    kills: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
    pilots: z.ZodInt;
    systems_controlled: z.ZodInt;
    victory_points: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>>;
export declare const zFwSystemsGet: z.ZodArray<z.ZodObject<{
    contested: z.ZodEnum<{
        captured: "captured";
        contested: "contested";
        uncontested: "uncontested";
        vulnerable: "vulnerable";
    }>;
    occupier_faction_id: z.ZodInt;
    owner_faction_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    victory_points: z.ZodInt;
    victory_points_threshold: z.ZodInt;
}, z.core.$loose>>;
/**
 * List of factions at war
 */
export declare const zFwWarsGet: z.ZodArray<z.ZodObject<{
    against_id: z.ZodInt;
    faction_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGroupId: z.ZodInt;
export declare const zIncursionsGet: z.ZodArray<z.ZodObject<{
    constellation_id: z.ZodInt;
    faction_id: z.ZodInt;
    has_boss: z.ZodBoolean;
    infested_solar_systems: z.ZodArray<z.ZodInt>;
    influence: z.ZodNumber;
    staging_solar_system_id: z.ZodInt;
    state: z.ZodEnum<{
        established: "established";
        mobilizing: "mobilizing";
        withdrawing: "withdrawing";
    }>;
    type: z.ZodString;
}, z.core.$loose>>;
export declare const zIndustryFacilitiesGet: z.ZodArray<z.ZodObject<{
    facility_id: z.ZodInt;
    owner_id: z.ZodInt;
    region_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    tax: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zIndustrySystemsGet: z.ZodArray<z.ZodObject<{
    cost_indices: z.ZodArray<z.ZodObject<{
        activity: z.ZodEnum<{
            copying: "copying";
            duplicating: "duplicating";
            invention: "invention";
            manufacturing: "manufacturing";
            none: "none";
            reaction: "reaction";
            researching_material_efficiency: "researching_material_efficiency";
            researching_technology: "researching_technology";
            researching_time_efficiency: "researching_time_efficiency";
            reverse_engineering: "reverse_engineering";
        }>;
        cost_index: z.ZodNumber;
    }, z.core.$loose>>;
    solar_system_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zInsurancePricesGet: z.ZodArray<z.ZodObject<{
    levels: z.ZodArray<z.ZodObject<{
        cost: z.ZodNumber;
        name: z.ZodString;
        payout: z.ZodNumber;
    }, z.core.$loose>>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zItemId: z.ZodInt;
export declare const zKillmailsKillmailIdKillmailHashGet: z.ZodObject<{
    attackers: z.ZodArray<z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        character_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        damage_done: z.ZodInt;
        faction_id: z.ZodOptional<z.ZodInt>;
        final_blow: z.ZodBoolean;
        security_status: z.ZodNumber;
        ship_type_id: z.ZodOptional<z.ZodInt>;
        weapon_type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>;
    killmail_id: z.ZodInt;
    killmail_time: z.ZodISODateTime;
    moon_id: z.ZodOptional<z.ZodInt>;
    solar_system_id: z.ZodInt;
    victim: z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        character_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        damage_taken: z.ZodInt;
        faction_id: z.ZodOptional<z.ZodInt>;
        items: z.ZodOptional<z.ZodArray<z.ZodObject<{
            flag: z.ZodInt;
            item_type_id: z.ZodInt;
            items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                flag: z.ZodInt;
                item_type_id: z.ZodInt;
                quantity_destroyed: z.ZodOptional<z.ZodInt>;
                quantity_dropped: z.ZodOptional<z.ZodInt>;
                singleton: z.ZodInt;
            }, z.core.$loose>>>;
            quantity_destroyed: z.ZodOptional<z.ZodInt>;
            quantity_dropped: z.ZodOptional<z.ZodInt>;
            singleton: z.ZodInt;
        }, z.core.$loose>>>;
        position: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, z.core.$loose>>;
        ship_type_id: z.ZodInt;
    }, z.core.$loose>;
    war_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zLoyaltyStoresCorporationIdOffersGet: z.ZodArray<z.ZodObject<{
    ak_cost: z.ZodOptional<z.ZodInt>;
    isk_cost: z.ZodInt;
    lp_cost: z.ZodInt;
    offer_id: z.ZodInt;
    quantity: z.ZodInt;
    required_items: z.ZodArray<z.ZodObject<{
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zMarketsGroupsGet: z.ZodArray<z.ZodInt>;
export declare const zMarketsGroupsMarketGroupIdGet: z.ZodObject<{
    description: z.ZodString;
    market_group_id: z.ZodInt;
    name: z.ZodString;
    parent_group_id: z.ZodOptional<z.ZodInt>;
    types: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zMarketsPricesGet: z.ZodArray<z.ZodObject<{
    adjusted_price: z.ZodOptional<z.ZodNumber>;
    average_price: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zMarketsRegionIdHistoryGet: z.ZodArray<z.ZodObject<{
    average: z.ZodNumber;
    date: z.ZodISODate;
    highest: z.ZodNumber;
    lowest: z.ZodNumber;
    order_count: z.ZodInt;
    volume: z.ZodInt;
}, z.core.$loose>>;
export declare const zMarketsRegionIdOrdersGet: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    is_buy_order: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodInt;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zMarketsRegionIdTypesGet: z.ZodArray<z.ZodInt>;
export declare const zMarketsStructuresStructureIdGet: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    is_buy_order: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodInt;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zMetaChangelogEntry: z.ZodObject<{
    compatibility_date: z.ZodISODate;
    description: z.ZodString;
    method: z.ZodEnum<{
        DELETE: "DELETE";
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
    }>;
    path: z.ZodString;
    type: z.ZodEnum<{
        breaking: "breaking";
        changed: "changed";
        new: "new";
        removed: "removed";
    }>;
}, z.core.$loose>;
export declare const zMetaChangelog: z.ZodObject<{
    changelog: z.ZodObject<{}, z.core.$catchall<z.ZodArray<z.ZodObject<{
        compatibility_date: z.ZodISODate;
        description: z.ZodString;
        method: z.ZodEnum<{
            DELETE: "DELETE";
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
        }>;
        path: z.ZodString;
        type: z.ZodEnum<{
            breaking: "breaking";
            changed: "changed";
            new: "new";
            removed: "removed";
        }>;
    }, z.core.$loose>>>>;
}, z.core.$loose>;
export declare const zMetaCompatibilityDates: z.ZodObject<{
    compatibility_dates: z.ZodArray<z.ZodISODate>;
}, z.core.$loose>;
export declare const zMetaNameEntry: z.ZodObject<{
    date: z.ZodString;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zMetaName: z.ZodObject<{
    current: z.ZodString;
    history: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        name: z.ZodString;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zMetaStatusRoutestatus: z.ZodObject<{
    method: z.ZodEnum<{
        DELETE: "DELETE";
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
    }>;
    path: z.ZodString;
    status: z.ZodEnum<{
        Degraded: "Degraded";
        Down: "Down";
        OK: "OK";
        Recovering: "Recovering";
        Unknown: "Unknown";
    }>;
}, z.core.$loose>;
export declare const zMetaStatus: z.ZodObject<{
    routes: z.ZodArray<z.ZodObject<{
        method: z.ZodEnum<{
            DELETE: "DELETE";
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
        }>;
        path: z.ZodString;
        status: z.ZodEnum<{
            Degraded: "Degraded";
            Down: "Down";
            OK: "OK";
            Recovering: "Recovering";
            Unknown: "Unknown";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsObjectivesDetailParticipants: z.ZodObject<{
    committed: z.ZodInt;
    contributors: z.ZodInt;
    total: z.ZodInt;
}, z.core.$loose>;
export declare const zPlanetId: z.ZodInt;
export declare const zCharactersStructuresMercenaryDensDetailSkyhook: z.ZodObject<{
    corporation_id: z.ZodInt;
    id: z.ZodInt;
    planet_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensListingMercenaryden: z.ZodObject<{
    id: z.ZodInt;
    planet_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensListing: z.ZodObject<{
    mercenary_dens: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        planet_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSkyhooksListingSkyhook: z.ZodObject<{
    id: z.ZodInt;
    planet_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSkyhooksListing: z.ZodObject<{
    skyhooks: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        planet_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zRaceId: z.ZodInt;
export declare const zRegionId: z.ZodInt;
/**
 * Ship tree group identifier.
 */
export declare const zShipTreeGroupId: z.ZodInt;
export declare const zSkyhooksRaidableTheftvulnerability: z.ZodObject<{
    end: z.ZodISODateTime;
    start: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zSolarSystemId: z.ZodInt;
export declare const zCorporationsProjectsDetailConfigurationcapturefwcomplex: z.ZodObject<{
    archetypes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        archetype_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationdefendfwcomplex: z.ZodObject<{
    archetypes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        archetype_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationdestroynpc: z.ZodObject<{
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationsalvagewreck: z.ZodObject<{
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationscansignature: z.ZodObject<{
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    signatures: z.ZodOptional<z.ZodArray<z.ZodObject<{
        signature_type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationexport: z.ZodObject<{
    amount: z.ZodInt;
    solar_system_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationsource: z.ZodObject<{
    solar_system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransportconfigurationimport: z.ZodObject<{
    sources: z.ZodArray<z.ZodObject<{
        solar_system_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransportstateexport: z.ZodObject<{
    amount: z.ZodOptional<z.ZodInt>;
    solar_system_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransportstateimportsource: z.ZodObject<{
    amount: z.ZodInt;
    solar_system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransportstateimport: z.ZodObject<{
    sources: z.ZodArray<z.ZodObject<{
        amount: z.ZodInt;
        solar_system_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailTransport: z.ZodObject<{
    configuration: z.ZodXor<readonly [z.ZodObject<{
        import: z.ZodOptional<z.ZodObject<{
            sources: z.ZodArray<z.ZodObject<{
                solar_system_id: z.ZodInt;
            }, z.core.$loose>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        export: z.ZodOptional<z.ZodObject<{
            amount: z.ZodInt;
            solar_system_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        transit: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$loose>]>;
    state: z.ZodXor<readonly [z.ZodObject<{
        import: z.ZodOptional<z.ZodObject<{
            sources: z.ZodArray<z.ZodObject<{
                amount: z.ZodInt;
                solar_system_id: z.ZodInt;
            }, z.core.$loose>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        export: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            solar_system_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        transit: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$loose>]>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsListingSovereigntyhub: z.ZodObject<{
    id: z.ZodInt;
    solar_system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsListing: z.ZodObject<{
    sovereignty_hubs: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        solar_system_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailBroadcastlocations: z.ZodObject<{
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailAccessandvisibility: z.ZodObject<{
    acl_protected: z.ZodBoolean;
    broadcast_locations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>>>;
    restrictions: z.ZodOptional<z.ZodObject<{
        maximum_age: z.ZodOptional<z.ZodInt>;
        minimum_age: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zRoute: z.ZodObject<{
    route: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zRouteConnection: z.ZodObject<{
    from: z.ZodInt;
    to: z.ZodInt;
}, z.core.$loose>;
export declare const zRouteRequestBody: z.ZodObject<{
    avoid_systems: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    connections: z.ZodOptional<z.ZodArray<z.ZodObject<{
        from: z.ZodInt;
        to: z.ZodInt;
    }, z.core.$loose>>>;
    preference: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        LessSecure: "LessSecure";
        Safer: "Safer";
        Shorter: "Shorter";
    }>>>;
    security_penalty: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
export declare const zSkyhooksRaidableVulnerableskyhook: z.ZodObject<{
    planet_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    theft_vulnerability: z.ZodObject<{
        end: z.ZodISODateTime;
        start: z.ZodISODateTime;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zSkyhooksRaidable: z.ZodObject<{
    skyhooks: z.ZodArray<z.ZodObject<{
        planet_id: z.ZodInt;
        solar_system_id: z.ZodInt;
        theft_vulnerability: z.ZodObject<{
            end: z.ZodISODateTime;
            start: z.ZodISODateTime;
        }, z.core.$loose>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zSovereigntyCampaignsGet: z.ZodArray<z.ZodObject<{
    attackers_score: z.ZodOptional<z.ZodNumber>;
    campaign_id: z.ZodInt;
    constellation_id: z.ZodInt;
    defender_id: z.ZodOptional<z.ZodInt>;
    defender_score: z.ZodOptional<z.ZodNumber>;
    event_type: z.ZodEnum<{
        ihub_defense: "ihub_defense";
        station_defense: "station_defense";
        station_freeport: "station_freeport";
        tcu_defense: "tcu_defense";
    }>;
    participants: z.ZodOptional<z.ZodArray<z.ZodObject<{
        alliance_id: z.ZodInt;
        score: z.ZodNumber;
    }, z.core.$loose>>>;
    solar_system_id: z.ZodInt;
    start_time: z.ZodISODateTime;
    structure_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zSovereigntySystemsDevelopment: z.ZodObject<{
    activity_defense_multiplier: z.ZodNumber;
    industrial_level: z.ZodInt;
    military_level: z.ZodInt;
    strategic_level: z.ZodInt;
}, z.core.$loose>;
export declare const zSovereigntySystemsFaction: z.ZodObject<{
    faction_id: z.ZodInt;
}, z.core.$loose>;
export declare const zSovereigntySystemsVulnerabilitywindow: z.ZodObject<{
    end: z.ZodISODateTime;
    start: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zSovereigntySystemsSovereigntyhub: z.ZodObject<{
    id: z.ZodInt;
    vulnerability_window: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
        start: z.ZodISODateTime;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zSovereigntySystemsAlliance: z.ZodObject<{
    alliance_id: z.ZodInt;
    claimed_since: z.ZodISODateTime;
    corporation_id: z.ZodInt;
    development: z.ZodObject<{
        activity_defense_multiplier: z.ZodNumber;
        industrial_level: z.ZodInt;
        military_level: z.ZodInt;
        strategic_level: z.ZodInt;
    }, z.core.$loose>;
    is_capital_system: z.ZodBoolean;
    sovereignty_hub: z.ZodObject<{
        id: z.ZodInt;
        vulnerability_window: z.ZodOptional<z.ZodObject<{
            end: z.ZodISODateTime;
            start: z.ZodISODateTime;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zSovereigntySystemsSolarsystem: z.ZodObject<{
    claim: z.ZodXor<readonly [z.ZodObject<{
        faction: z.ZodOptional<z.ZodObject<{
            faction_id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        alliance: z.ZodOptional<z.ZodObject<{
            alliance_id: z.ZodInt;
            claimed_since: z.ZodISODateTime;
            corporation_id: z.ZodInt;
            development: z.ZodObject<{
                activity_defense_multiplier: z.ZodNumber;
                industrial_level: z.ZodInt;
                military_level: z.ZodInt;
                strategic_level: z.ZodInt;
            }, z.core.$loose>;
            is_capital_system: z.ZodBoolean;
            sovereignty_hub: z.ZodObject<{
                id: z.ZodInt;
                vulnerability_window: z.ZodOptional<z.ZodObject<{
                    end: z.ZodISODateTime;
                    start: z.ZodISODateTime;
                }, z.core.$loose>>;
            }, z.core.$loose>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        unclaimed: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>]>;
    solar_system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zSovereigntySystems: z.ZodObject<{
    solar_systems: z.ZodArray<z.ZodObject<{
        claim: z.ZodXor<readonly [z.ZodObject<{
            faction: z.ZodOptional<z.ZodObject<{
                faction_id: z.ZodInt;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            alliance: z.ZodOptional<z.ZodObject<{
                alliance_id: z.ZodInt;
                claimed_since: z.ZodISODateTime;
                corporation_id: z.ZodInt;
                development: z.ZodObject<{
                    activity_defense_multiplier: z.ZodNumber;
                    industrial_level: z.ZodInt;
                    military_level: z.ZodInt;
                    strategic_level: z.ZodInt;
                }, z.core.$loose>;
                is_capital_system: z.ZodBoolean;
                sovereignty_hub: z.ZodObject<{
                    id: z.ZodInt;
                    vulnerability_window: z.ZodOptional<z.ZodObject<{
                        end: z.ZodISODateTime;
                        start: z.ZodISODateTime;
                    }, z.core.$loose>>;
                }, z.core.$loose>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            unclaimed: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>]>;
        solar_system_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zStationId: z.ZodInt;
export declare const zCorporationsDetail: z.ZodObject<{
    alliance_id: z.ZodOptional<z.ZodInt>;
    ceo_id: z.ZodOptional<z.ZodInt>;
    creator_id: z.ZodOptional<z.ZodInt>;
    date_founded: z.ZodOptional<z.ZodISODateTime>;
    description: z.ZodString;
    enlisted_faction_id: z.ZodOptional<z.ZodInt>;
    friendly_fire: z.ZodEnum<{
        illegal: "illegal";
        legal: "legal";
    }>;
    home_station_id: z.ZodInt;
    member_count: z.ZodInt;
    name: z.ZodString;
    palette: z.ZodOptional<z.ZodObject<{
        main_color: z.ZodString;
        secondary_color: z.ZodOptional<z.ZodString>;
        tertiary_color: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    shares: z.ZodInt;
    state: z.ZodEnum<{
        active: "active";
        closed: "closed";
    }>;
    tax_rates: z.ZodObject<{
        isk: z.ZodNumber;
        loyalty_point: z.ZodNumber;
    }, z.core.$loose>;
    ticker: z.ZodString;
    type: z.ZodEnum<{
        npc_owned: "npc_owned";
        player_owned: "player_owned";
    }>;
    url: z.ZodOptional<z.ZodString>;
    war_eligible: z.ZodBoolean;
}, z.core.$loose>;
export declare const zStatus: z.ZodObject<{
    players: z.ZodInt;
    server_version: z.ZodString;
    start_time: z.ZodISODateTime;
    vip: z.ZodBoolean;
}, z.core.$loose>;
export declare const zTypeId: z.ZodInt;
export declare const zCharactersSkillqueueSkill: z.ZodObject<{
    finish_date: z.ZodOptional<z.ZodISODateTime>;
    finished_level: z.ZodInt;
    level_end_sp: z.ZodOptional<z.ZodInt>;
    level_start_sp: z.ZodOptional<z.ZodInt>;
    queue_position: z.ZodInt;
    skill_id: z.ZodInt;
    start_date: z.ZodOptional<z.ZodISODateTime>;
    training_start_sp: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCharactersStructuresMercenaryDensDetail: z.ZodObject<{
    evolution: z.ZodObject<{
        anarchy: z.ZodObject<{
            amount: z.ZodInt;
            level: z.ZodEnum<{
                Level0: "Level0";
                Level1: "Level1";
                Level2: "Level2";
                Level3: "Level3";
                Level4: "Level4";
                Unspecified: "Unspecified";
            }>;
        }, z.core.$loose>;
        development: z.ZodObject<{
            amount: z.ZodInt;
            level: z.ZodEnum<{
                Level0: "Level0";
                Level1: "Level1";
                Level2: "Level2";
                Level3: "Level3";
                Level4: "Level4";
                Unspecified: "Unspecified";
            }>;
        }, z.core.$loose>;
    }, z.core.$loose>;
    id: z.ZodInt;
    infomorphs: z.ZodObject<{
        amount: z.ZodInt;
    }, z.core.$loose>;
    reinforcement_timer: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
    }, z.core.$loose>>;
    skyhook: z.ZodObject<{
        corporation_id: z.ZodInt;
        id: z.ZodInt;
        planet_id: z.ZodInt;
    }, z.core.$loose>;
    state: z.ZodEnum<{
        Disabled: "Disabled";
        Paused: "Paused";
        Running: "Running";
        Unspecified: "Unspecified";
    }>;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationdamageship: z.ZodObject<{
    identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationdeliveritem: z.ZodObject<{
    docking_locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        structure_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        station_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    items: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    office_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationdestroyship: z.ZodObject<{
    identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationlostship: z.ZodObject<{
    identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationmanufactureitem: z.ZodObject<{
    docking_locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        structure_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        station_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    items: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    owner: z.ZodEnum<{
        Any: "Any";
        Character: "Character";
        Corporation: "Corporation";
    }>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationminematerial: z.ZodObject<{
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    materials: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationremoteboostshield: z.ZodObject<{
    identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationremoterepairarmor: z.ZodObject<{
    identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailConfigurationshipinsurance: z.ZodObject<{
    conflict_type: z.ZodEnum<{
        Any: "Any";
        Pve: "Pve";
        Pvp: "Pvp";
    }>;
    identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        faction_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        solar_system_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        constellation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        region_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
    reimburse_implants: z.ZodBoolean;
    ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        group_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSkyhooksDetailReagent: z.ZodObject<{
    last_cycle: z.ZodISODateTime;
    secured_stock: z.ZodInt;
    type_id: z.ZodInt;
    unsecured_stock: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSkyhooksDetail: z.ZodObject<{
    effective_workforce: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    is_active: z.ZodBoolean;
    planet_id: z.ZodInt;
    reagents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        last_cycle: z.ZodISODateTime;
        secured_stock: z.ZodInt;
        type_id: z.ZodInt;
        unsecured_stock: z.ZodInt;
    }, z.core.$loose>>>;
    reinforcement_timer: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        ArmorReinforced: "ArmorReinforced";
        ArmorVulnerable: "ArmorVulnerable";
        HullReinforced: "HullReinforced";
        HullVulnerable: "HullVulnerable";
        ShieldVulnerable: "ShieldVulnerable";
        Unspecified: "Unspecified";
    }>;
    theft_vulnerability: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
        start: z.ZodISODateTime;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailReagent: z.ZodObject<{
    amount: z.ZodInt;
    burning_per_hour: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailReagentbay: z.ZodObject<{
    last_updated: z.ZodISODateTime;
    reagents: z.ZodArray<z.ZodObject<{
        amount: z.ZodInt;
        burning_per_hour: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetailUpgrade: z.ZodObject<{
    power_state: z.ZodEnum<{
        Low: "Low";
        Offline: "Offline";
        Online: "Online";
        Pending: "Pending";
        Unspecified: "Unspecified";
    }>;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCorporationsStructuresSovereigntyHubsDetail: z.ZodObject<{
    fuel_access_list_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    reagent_bay: z.ZodObject<{
        last_updated: z.ZodISODateTime;
        reagents: z.ZodArray<z.ZodObject<{
            amount: z.ZodInt;
            burning_per_hour: z.ZodInt;
            type_id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    resources: z.ZodObject<{
        power: z.ZodObject<{
            allocated: z.ZodInt;
            available: z.ZodInt;
        }, z.core.$loose>;
        workforce: z.ZodObject<{
            allocated: z.ZodInt;
            available: z.ZodInt;
        }, z.core.$loose>;
    }, z.core.$loose>;
    solar_system_id: z.ZodInt;
    upgrades: z.ZodArray<z.ZodObject<{
        power_state: z.ZodEnum<{
            Low: "Low";
            Offline: "Offline";
            Online: "Online";
            Pending: "Pending";
            Unspecified: "Unspecified";
        }>;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    vulnerability_window: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
        start: z.ZodISODateTime;
    }, z.core.$loose>>;
    workforce_transport: z.ZodObject<{
        configuration: z.ZodXor<readonly [z.ZodObject<{
            import: z.ZodOptional<z.ZodObject<{
                sources: z.ZodArray<z.ZodObject<{
                    solar_system_id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            export: z.ZodOptional<z.ZodObject<{
                amount: z.ZodInt;
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            transit: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        }, z.core.$loose>]>;
        state: z.ZodXor<readonly [z.ZodObject<{
            import: z.ZodOptional<z.ZodObject<{
                sources: z.ZodArray<z.ZodObject<{
                    amount: z.ZodInt;
                    solar_system_id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            export: z.ZodOptional<z.ZodObject<{
                amount: z.ZodOptional<z.ZodInt>;
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            transit: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        }, z.core.$loose>]>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zCosmeticsSkinr: z.ZodObject<{
    creator_id: z.ZodInt;
    id: z.ZodString;
    layout: z.ZodObject<{
        pattern_blend_mode: z.ZodEnum<{
            exclusion: "exclusion";
            nested: "nested";
            nested_inverted: "nested_inverted";
            normal: "normal";
            subtract: "subtract";
        }>;
        slots: z.ZodArray<z.ZodObject<{
            configuration: z.ZodXor<readonly [z.ZodObject<{
                nanocoating: z.ZodOptional<z.ZodObject<{
                    id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>, z.ZodObject<{
                pattern: z.ZodOptional<z.ZodObject<{
                    configuration: z.ZodObject<{
                        mirrored: z.ZodBoolean;
                        projection: z.ZodObject<{
                            slot1: z.ZodBoolean;
                            slot2: z.ZodBoolean;
                            slot3: z.ZodBoolean;
                            slot4: z.ZodBoolean;
                        }, z.core.$loose>;
                        transform: z.ZodObject<{
                            position: z.ZodObject<{
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                z: z.ZodNumber;
                            }, z.core.$loose>;
                            rotation: z.ZodObject<{
                                w: z.ZodNumber;
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                z: z.ZodNumber;
                            }, z.core.$loose>;
                            scaling: z.ZodObject<{
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                z: z.ZodNumber;
                            }, z.core.$loose>;
                        }, z.core.$loose>;
                    }, z.core.$loose>;
                    id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>]>;
            id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    line: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    ship_type_id: z.ZodInt;
    tier: z.ZodObject<{
        level: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zUuid: z.ZodUUID;
export declare const zCharactersDetail: z.ZodObject<{
    achievement_score: z.ZodInt;
    alliance_id: z.ZodOptional<z.ZodInt>;
    birthday: z.ZodISODateTime;
    bloodline_id: z.ZodInt;
    character_title_id: z.ZodOptional<z.ZodUUID>;
    corporation_id: z.ZodInt;
    corporation_title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    faction_id: z.ZodOptional<z.ZodInt>;
    gender: z.ZodEnum<{
        female: "female";
        male: "male";
    }>;
    name: z.ZodString;
    race_id: z.ZodInt;
    security_status: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const zCharactersMercenaryTacticalOperationsDetail: z.ZodObject<{
    dungeon_type_id: z.ZodInt;
    expires: z.ZodISODateTime;
    id: z.ZodUUID;
    mercenary_den_id: z.ZodInt;
    state: z.ZodEnum<{
        Available: "Available";
        Completed: "Completed";
        Expired: "Expired";
        Removed: "Removed";
        Started: "Started";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCharactersMercenaryTacticalOperationsListingOperation: z.ZodObject<{
    id: z.ZodUUID;
    mercenary_den_id: z.ZodInt;
}, z.core.$loose>;
export declare const zCharactersMercenaryTacticalOperationsListing: z.ZodObject<{
    operations: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        mercenary_den_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersMilitaryCampaignsObjectivesParticipation: z.ZodObject<{
    campaign_id: z.ZodUUID;
    contributed: z.ZodInt;
    id: z.ZodUUID;
    is_committed: z.ZodBoolean;
    last_modified: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zCharactersMilitaryCampaignsObjectivesParticipationCharacterobjective: z.ZodObject<{
    campaign_id: z.ZodUUID;
    contributed: z.ZodInt;
    id: z.ZodUUID;
    is_committed: z.ZodBoolean;
    last_modified: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zCharactersMilitaryCampaignsObjectivesListing: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    objectives: z.ZodArray<z.ZodObject<{
        campaign_id: z.ZodUUID;
        contributed: z.ZodInt;
        id: z.ZodUUID;
        is_committed: z.ZodBoolean;
        last_modified: z.ZodISODateTime;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCharactersParagonHubSkinrItem: z.ZodObject<{
    created: z.ZodISODateTime;
    expires: z.ZodISODateTime;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    price: z.ZodXor<readonly [z.ZodObject<{
        isk: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>, z.ZodObject<{
        plex: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>;
    quantity: z.ZodInt;
    seller_id: z.ZodInt;
    skinr_id: z.ZodString;
    state: z.ZodEnum<{
        expired: "expired";
        listed: "listed";
        removed: "removed";
        sold_out: "sold_out";
    }>;
    target: z.ZodXor<readonly [z.ZodObject<{
        character_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>, z.ZodObject<{
        public: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>]>;
}, z.core.$loose>;
export declare const zCharactersParagonHubSkinr: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
        target: z.ZodXor<readonly [z.ZodObject<{
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            alliance_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            public: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>]>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetail: z.ZodObject<{
    configuration: z.ZodXor<readonly [z.ZodObject<{
        capture_fw_complex: z.ZodOptional<z.ZodObject<{
            archetypes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                archetype_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        damage_ship: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        defend_fw_complex: z.ZodOptional<z.ZodObject<{
            archetypes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                archetype_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        deliver_item: z.ZodOptional<z.ZodObject<{
            docking_locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                structure_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                station_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            items: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            office_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        destroy_npc: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        destroy_ship: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        earn_loyalty_point: z.ZodOptional<z.ZodObject<{
            corporations: z.ZodOptional<z.ZodArray<z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        lost_ship: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        manual: z.ZodOptional<z.ZodObject<{}, z.core.$catchall<z.ZodUnknown>>>;
    }, z.core.$loose>, z.ZodObject<{
        manufacture_item: z.ZodOptional<z.ZodObject<{
            docking_locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                structure_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                station_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            items: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            owner: z.ZodEnum<{
                Any: "Any";
                Character: "Character";
                Corporation: "Corporation";
            }>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        mine_material: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            materials: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        remote_boost_shield: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        remote_repair_armor: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        salvage_wreck: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        scan_signature: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            signatures: z.ZodOptional<z.ZodArray<z.ZodObject<{
                signature_type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        ship_insurance: z.ZodOptional<z.ZodObject<{
            conflict_type: z.ZodEnum<{
                Any: "Any";
                Pve: "Pve";
                Pvp: "Pvp";
            }>;
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            reimburse_implants: z.ZodBoolean;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        unknown: z.ZodOptional<z.ZodObject<{
            data: z.ZodUnknown;
            type: z.ZodString;
        }, z.core.$loose>>;
    }, z.core.$loose>]>;
    contribution: z.ZodOptional<z.ZodObject<{
        participation_limit: z.ZodOptional<z.ZodInt>;
        reward_per_contribution: z.ZodOptional<z.ZodNumber>;
        submission_limit: z.ZodOptional<z.ZodInt>;
        submission_multiplier: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
    creator: z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>;
    details: z.ZodObject<{
        career: z.ZodEnum<{
            Enforcer: "Enforcer";
            Explorer: "Explorer";
            Industrialist: "Industrialist";
            "Soldier of Fortune": "Soldier of Fortune";
            Unspecified: "Unspecified";
        }>;
        created: z.ZodISODateTime;
        description: z.ZodString;
        expires: z.ZodOptional<z.ZodISODateTime>;
        finished: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$loose>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    name: z.ZodString;
    progress: z.ZodObject<{
        current: z.ZodInt;
        desired: z.ZodInt;
    }, z.core.$loose>;
    reward: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        remaining: z.ZodNumber;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        Active: "Active";
        Closed: "Closed";
        Completed: "Completed";
        Deleted: "Deleted";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCorporationsProjectsDetailProject: z.ZodObject<{
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    name: z.ZodString;
    progress: z.ZodObject<{
        current: z.ZodInt;
        desired: z.ZodInt;
    }, z.core.$loose>;
    reward: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        remaining: z.ZodNumber;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        Active: "Active";
        Closed: "Closed";
        Completed: "Completed";
        Deleted: "Deleted";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCorporationsProjectsListing: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    projects: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetail: z.ZodObject<{
    access_and_visibility: z.ZodObject<{
        acl_protected: z.ZodBoolean;
        broadcast_locations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodInt;
            name: z.ZodString;
        }, z.core.$loose>>>;
        restrictions: z.ZodOptional<z.ZodObject<{
            maximum_age: z.ZodOptional<z.ZodInt>;
            minimum_age: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    configuration: z.ZodObject<{
        method: z.ZodString;
        parameters: z.ZodObject<{}, z.core.$catchall<z.ZodXor<readonly [z.ZodObject<{
            matcher: z.ZodOptional<z.ZodObject<{
                values: z.ZodArray<z.ZodObject<{
                    value_type: z.ZodString;
                    values: z.ZodArray<z.ZodString>;
                }, z.core.$loose>>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            options: z.ZodOptional<z.ZodObject<{
                selected: z.ZodArray<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            boolean: z.ZodOptional<z.ZodObject<{
                value: z.ZodBoolean;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            corporation_item_delivery: z.ZodOptional<z.ZodObject<{
                corporation_office_location: z.ZodObject<{
                    values: z.ZodArray<z.ZodObject<{
                        value_type: z.ZodString;
                        values: z.ZodArray<z.ZodString>;
                    }, z.core.$loose>>;
                }, z.core.$loose>;
                item_type: z.ZodObject<{
                    values: z.ZodArray<z.ZodObject<{
                        value_type: z.ZodString;
                        values: z.ZodArray<z.ZodString>;
                    }, z.core.$loose>>;
                }, z.core.$loose>;
            }, z.core.$loose>>;
        }, z.core.$loose>]>>>;
        version: z.ZodInt;
    }, z.core.$loose>;
    contribution: z.ZodOptional<z.ZodObject<{
        contribution_per_participant_limit: z.ZodOptional<z.ZodInt>;
        max_committed_participants: z.ZodInt;
        reward_per_contribution: z.ZodOptional<z.ZodNumber>;
        submission_limit: z.ZodOptional<z.ZodInt>;
        submission_multiplier: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
    details: z.ZodObject<{
        career: z.ZodEnum<{
            Enforcer: "Enforcer";
            Explorer: "Explorer";
            Industrialist: "Industrialist";
            "Soldier of Fortune": "Soldier of Fortune";
            Unspecified: "Unspecified";
        }>;
        created: z.ZodISODateTime;
        creator: z.ZodObject<{
            character: z.ZodObject<{
                id: z.ZodInt;
                name: z.ZodString;
            }, z.core.$loose>;
            corporation: z.ZodObject<{
                id: z.ZodInt;
                name: z.ZodString;
            }, z.core.$loose>;
        }, z.core.$loose>;
        description: z.ZodString;
        expires: z.ZodOptional<z.ZodISODateTime>;
        finished: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$loose>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    name: z.ZodString;
    progress: z.ZodObject<{
        current: z.ZodInt;
        desired: z.ZodInt;
    }, z.core.$loose>;
    reward: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        remaining: z.ZodNumber;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        Active: "Active";
        Closed: "Closed";
        Completed: "Completed";
        Deleted: "Deleted";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zFreelanceJobsDetailFreelancejob: z.ZodObject<{
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    name: z.ZodString;
    progress: z.ZodObject<{
        current: z.ZodInt;
        desired: z.ZodInt;
    }, z.core.$loose>;
    reward: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        remaining: z.ZodNumber;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        Active: "Active";
        Closed: "Closed";
        Completed: "Completed";
        Deleted: "Deleted";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zCharactersFreelanceJobsListing: z.ZodObject<{
    freelance_jobs: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zCorporationsFreelanceJobsListing: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    freelance_jobs: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zFreelanceJobsListing: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    freelance_jobs: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsDetail: z.ZodObject<{
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodUUID;
    progress: z.ZodInt;
    started: z.ZodOptional<z.ZodISODateTime>;
    state: z.ZodEnum<{
        Active: "Active";
        Completed: "Completed";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsDetailCampaign: z.ZodObject<{
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodUUID;
    progress: z.ZodInt;
    started: z.ZodOptional<z.ZodISODateTime>;
    state: z.ZodEnum<{
        Active: "Active";
        Completed: "Completed";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsListing: z.ZodObject<{
    campaigns: z.ZodArray<z.ZodObject<{
        finished: z.ZodOptional<z.ZodISODateTime>;
        id: z.ZodUUID;
        progress: z.ZodInt;
        started: z.ZodOptional<z.ZodISODateTime>;
        state: z.ZodEnum<{
            Active: "Active";
            Completed: "Completed";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsObjectivesDetail: z.ZodObject<{
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    participants: z.ZodObject<{
        committed: z.ZodInt;
        contributors: z.ZodInt;
        total: z.ZodInt;
    }, z.core.$loose>;
    progress: z.ZodInt;
    started: z.ZodOptional<z.ZodISODateTime>;
    state: z.ZodEnum<{
        Active: "Active";
        Completed: "Completed";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsObjectivesDetailObjective: z.ZodObject<{
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    participants: z.ZodObject<{
        committed: z.ZodInt;
        contributors: z.ZodInt;
        total: z.ZodInt;
    }, z.core.$loose>;
    progress: z.ZodInt;
    started: z.ZodOptional<z.ZodISODateTime>;
    state: z.ZodEnum<{
        Active: "Active";
        Completed: "Completed";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zMilitaryCampaignsObjectivesListing: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    objectives: z.ZodArray<z.ZodObject<{
        finished: z.ZodOptional<z.ZodISODateTime>;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        participants: z.ZodObject<{
            committed: z.ZodInt;
            contributors: z.ZodInt;
            total: z.ZodInt;
        }, z.core.$loose>;
        progress: z.ZodInt;
        started: z.ZodOptional<z.ZodISODateTime>;
        state: z.ZodEnum<{
            Active: "Active";
            Completed: "Completed";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zParagonHubSkinrInternalItem: z.ZodObject<{
    created: z.ZodISODateTime;
    expires: z.ZodISODateTime;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    price: z.ZodXor<readonly [z.ZodObject<{
        isk: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>, z.ZodObject<{
        plex: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>]>;
    quantity: z.ZodInt;
    seller_id: z.ZodInt;
    skinr_id: z.ZodString;
    state: z.ZodEnum<{
        expired: "expired";
        listed: "listed";
        removed: "removed";
        sold_out: "sold_out";
    }>;
}, z.core.$loose>;
export declare const zParagonHubSkinr: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zParagonHubSkinrAlliances: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zParagonHubSkinrCharacters: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zParagonHubSkinrCorporations: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zUniverseAncestriesGet: z.ZodArray<z.ZodObject<{
    bloodline_id: z.ZodInt;
    description: z.ZodString;
    icon_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    name: z.ZodString;
    short_description: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>;
export declare const zUniverseAsteroidBeltsAsteroidBeltIdGet: z.ZodObject<{
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseBloodlinesGet: z.ZodArray<z.ZodObject<{
    bloodline_id: z.ZodInt;
    charisma: z.ZodInt;
    corporation_id: z.ZodInt;
    description: z.ZodString;
    intelligence: z.ZodInt;
    memory: z.ZodInt;
    name: z.ZodString;
    perception: z.ZodInt;
    race_id: z.ZodInt;
    ship_type_id: z.ZodInt;
    willpower: z.ZodInt;
}, z.core.$loose>>;
export declare const zUniverseCategoriesCategoryIdGet: z.ZodObject<{
    category_id: z.ZodInt;
    groups: z.ZodArray<z.ZodInt>;
    name: z.ZodString;
    published: z.ZodBoolean;
}, z.core.$loose>;
export declare const zUniverseCategoriesGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseConstellationsConstellationIdGet: z.ZodObject<{
    constellation_id: z.ZodInt;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    region_id: z.ZodInt;
    systems: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zUniverseConstellationsGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseFactionsGet: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodOptional<z.ZodInt>;
    description: z.ZodString;
    faction_id: z.ZodInt;
    is_unique: z.ZodBoolean;
    militia_corporation_id: z.ZodOptional<z.ZodInt>;
    name: z.ZodString;
    size_factor: z.ZodNumber;
    solar_system_id: z.ZodOptional<z.ZodInt>;
    station_count: z.ZodInt;
    station_system_count: z.ZodInt;
}, z.core.$loose>>;
export declare const zUniverseGraphicsGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseGraphicsGraphicIdGet: z.ZodObject<{
    collision_file: z.ZodOptional<z.ZodString>;
    graphic_file: z.ZodOptional<z.ZodString>;
    graphic_id: z.ZodInt;
    icon_folder: z.ZodOptional<z.ZodString>;
    sof_dna: z.ZodOptional<z.ZodString>;
    sof_fation_name: z.ZodOptional<z.ZodString>;
    sof_hull_name: z.ZodOptional<z.ZodString>;
    sof_race_name: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zUniverseGroupsGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseGroupsGroupIdGet: z.ZodObject<{
    category_id: z.ZodInt;
    group_id: z.ZodInt;
    name: z.ZodString;
    published: z.ZodBoolean;
    types: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zUniverseIdsPost: z.ZodObject<{
    agents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    alliances: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    characters: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    constellations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    corporations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    inventory_types: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    regions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    stations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    systems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const zUniverseMoonsMoonIdGet: z.ZodObject<{
    moon_id: z.ZodInt;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseNamesPost: z.ZodArray<z.ZodObject<{
    category: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        constellation: "constellation";
        corporation: "corporation";
        faction: "faction";
        inventory_type: "inventory_type";
        region: "region";
        solar_system: "solar_system";
        station: "station";
    }>;
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zUniversePlanetsPlanetIdGet: z.ZodObject<{
    name: z.ZodString;
    planet_id: z.ZodInt;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseRacesGet: z.ZodArray<z.ZodObject<{
    alliance_id: z.ZodInt;
    description: z.ZodString;
    name: z.ZodString;
    race_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zUniverseRegionsGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseRegionsRegionIdGet: z.ZodObject<{
    constellations: z.ZodArray<z.ZodInt>;
    description: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    region_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseSchematicsSchematicIdGet: z.ZodObject<{
    cycle_time: z.ZodInt;
    schematic_name: z.ZodString;
}, z.core.$loose>;
export declare const zUniverseStargatesStargateIdGet: z.ZodObject<{
    destination: z.ZodObject<{
        stargate_id: z.ZodInt;
        system_id: z.ZodInt;
    }, z.core.$loose>;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    stargate_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseStarsStarIdGet: z.ZodObject<{
    age: z.ZodInt;
    luminosity: z.ZodNumber;
    name: z.ZodString;
    radius: z.ZodInt;
    solar_system_id: z.ZodInt;
    spectral_class: z.ZodEnum<{
        A0: "A0";
        A0IV: "A0IV";
        A0IV2: "A0IV2";
        "F0 IV": "F0 IV";
        "F0 V": "F0 V";
        "F0 VI": "F0 VI";
        "F1 IV": "F1 IV";
        "F1 V": "F1 V";
        "F1 VI": "F1 VI";
        "F2 IV": "F2 IV";
        "F2 V": "F2 V";
        "F2 VI": "F2 VI";
        "F3 IV": "F3 IV";
        "F3 V": "F3 V";
        "F3 VI": "F3 VI";
        "F4 IV": "F4 IV";
        "F4 V": "F4 V";
        "F4 VI": "F4 VI";
        "F5 IV": "F5 IV";
        "F5 V": "F5 V";
        "F5 VI": "F5 VI";
        "F6 IV": "F6 IV";
        "F6 V": "F6 V";
        "F6 VI": "F6 VI";
        "F7 V": "F7 V";
        "F7 VI": "F7 VI";
        "F8 V": "F8 V";
        "F8 VI": "F8 VI";
        "F9 IV": "F9 IV";
        "F9 V": "F9 V";
        "F9 VI": "F9 VI";
        "G0 IV": "G0 IV";
        "G0 V": "G0 V";
        "G0 VI": "G0 VI";
        "G1 IV": "G1 IV";
        "G1 V": "G1 V";
        "G1 VI": "G1 VI";
        "G2 IV": "G2 IV";
        "G2 V": "G2 V";
        "G2 VI": "G2 VI";
        "G3 IV": "G3 IV";
        "G3 V": "G3 V";
        "G3 VI": "G3 VI";
        "G4 IV": "G4 IV";
        "G4 V": "G4 V";
        "G4 VI": "G4 VI";
        "G5 IV": "G5 IV";
        "G5 V": "G5 V";
        "G5 VI": "G5 VI";
        "G6 V": "G6 V";
        "G6 VI": "G6 VI";
        "G7 IV": "G7 IV";
        "G7 V": "G7 V";
        "G7 VI": "G7 VI";
        "G8 IV": "G8 IV";
        "G8 V": "G8 V";
        "G8 VI": "G8 VI";
        "G9 V": "G9 V";
        "G9 VI": "G9 VI";
        "K0 IV": "K0 IV";
        "K0 V": "K0 V";
        "K1 IV": "K1 IV";
        "K1 V": "K1 V";
        "K2 IV": "K2 IV";
        "K2 V": "K2 V";
        "K3 IV": "K3 IV";
        "K3 V": "K3 V";
        "K4 IV": "K4 IV";
        "K4 V": "K4 V";
        "K5 IV": "K5 IV";
        "K5 V": "K5 V";
        "K6 IV": "K6 IV";
        "K6 V": "K6 V";
        "K7 IV": "K7 IV";
        "K7 V": "K7 V";
        "K8 IV": "K8 IV";
        "K8 V": "K8 V";
        "K9 IV": "K9 IV";
        "K9 V": "K9 V";
        "M0 V": "M0 V";
        "M1 V": "M1 V";
        "M2 V": "M2 V";
        "M3 V": "M3 V";
        "M4 V": "M4 V";
        "M5 V": "M5 V";
        "M6 V": "M6 V";
        "M7 V": "M7 V";
        "M8 V": "M8 V";
        "M9 V": "M9 V";
    }>;
    temperature: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseStationsStationIdGet: z.ZodObject<{
    max_dockable_ship_volume: z.ZodNumber;
    name: z.ZodString;
    office_rental_cost: z.ZodNumber;
    owner: z.ZodOptional<z.ZodInt>;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    race_id: z.ZodOptional<z.ZodInt>;
    reprocessing_efficiency: z.ZodNumber;
    reprocessing_stations_take: z.ZodNumber;
    services: z.ZodArray<z.ZodEnum<{
        "assasination-missions": "assasination-missions";
        "black-market": "black-market";
        "bounty-missions": "bounty-missions";
        cloning: "cloning";
        "courier-missions": "courier-missions";
        "dna-therapy": "dna-therapy";
        docking: "docking";
        factory: "factory";
        fitting: "fitting";
        gambling: "gambling";
        insurance: "insurance";
        interbus: "interbus";
        "jump-clone-facility": "jump-clone-facility";
        labratory: "labratory";
        "loyalty-point-store": "loyalty-point-store";
        market: "market";
        "navy-offices": "navy-offices";
        news: "news";
        "office-rental": "office-rental";
        paintshop: "paintshop";
        refinery: "refinery";
        "repair-facilities": "repair-facilities";
        "reprocessing-plant": "reprocessing-plant";
        "security-offices": "security-offices";
        "stock-exchange": "stock-exchange";
        storage: "storage";
        surgery: "surgery";
    }>>;
    station_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseStructuresGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseStructuresStructureIdGet: z.ZodObject<{
    name: z.ZodString;
    owner_id: z.ZodInt;
    position: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>>;
    solar_system_id: z.ZodInt;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zUniverseSystemJumpsGet: z.ZodArray<z.ZodObject<{
    ship_jumps: z.ZodInt;
    system_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zUniverseSystemKillsGet: z.ZodArray<z.ZodObject<{
    npc_kills: z.ZodInt;
    pod_kills: z.ZodInt;
    ship_kills: z.ZodInt;
    system_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zUniverseSystemsGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseSystemsSystemIdGet: z.ZodObject<{
    constellation_id: z.ZodInt;
    name: z.ZodString;
    planets: z.ZodOptional<z.ZodArray<z.ZodObject<{
        asteroid_belts: z.ZodOptional<z.ZodArray<z.ZodInt>>;
        moons: z.ZodOptional<z.ZodArray<z.ZodInt>>;
        planet_id: z.ZodInt;
    }, z.core.$loose>>>;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    security_class: z.ZodOptional<z.ZodString>;
    security_status: z.ZodNumber;
    star_id: z.ZodOptional<z.ZodInt>;
    stargates: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    stations: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zUniverseTypesGet: z.ZodArray<z.ZodInt>;
export declare const zUniverseTypesTypeIdGet: z.ZodObject<{
    capacity: z.ZodOptional<z.ZodNumber>;
    description: z.ZodString;
    dogma_attributes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        attribute_id: z.ZodInt;
        value: z.ZodNumber;
    }, z.core.$loose>>>;
    dogma_effects: z.ZodOptional<z.ZodArray<z.ZodObject<{
        effect_id: z.ZodInt;
        is_default: z.ZodBoolean;
    }, z.core.$loose>>>;
    graphic_id: z.ZodOptional<z.ZodInt>;
    group_id: z.ZodInt;
    icon_id: z.ZodOptional<z.ZodInt>;
    market_group_id: z.ZodOptional<z.ZodInt>;
    mass: z.ZodOptional<z.ZodNumber>;
    name: z.ZodString;
    packaged_volume: z.ZodOptional<z.ZodNumber>;
    portion_size: z.ZodOptional<z.ZodInt>;
    published: z.ZodBoolean;
    radius: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodInt;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const zWarsGet: z.ZodArray<z.ZodInt>;
export declare const zWarsWarIdGet: z.ZodObject<{
    aggressor: z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        isk_destroyed: z.ZodNumber;
        ships_killed: z.ZodInt;
    }, z.core.$loose>;
    allies: z.ZodOptional<z.ZodArray<z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    declared: z.ZodISODateTime;
    defender: z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        isk_destroyed: z.ZodNumber;
        ships_killed: z.ZodInt;
    }, z.core.$loose>;
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodInt;
    mutual: z.ZodBoolean;
    open_for_allies: z.ZodBoolean;
    retracted: z.ZodOptional<z.ZodISODateTime>;
    started: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zWarsWarIdKillmailsGet: z.ZodArray<z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>>;
/**
 * The language to use for the response.
 */
export declare const zAcceptLanguage: z.ZodDefault<z.ZodEnum<{
    de: "de";
    en: "en";
    es: "es";
    fr: "fr";
    ja: "ja";
    ko: "ko";
    ru: "ru";
    zh: "zh";
}>>;
/**
 * The compatibility date for the request.
 */
export declare const zCompatibilityDate2: z.ZodEnum<{
    "2026-08-18": "2026-08-18";
}>;
/**
 * The date the resource was last modified. A 304 will be returned if the resource has not been modified since this date.
 */
export declare const zIfModifiedSince: z.ZodString;
/**
 * The ETag of the previous request. A 304 will be returned if this matches the current ETag.
 */
export declare const zIfNoneMatch: z.ZodString;
/**
 * The tenant ID for the request.
 */
export declare const zTenant: z.ZodDefault<z.ZodString>;
export declare const zGetAlliancesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetAlliancesResponse: z.ZodArray<z.ZodInt>;
export declare const zGetAlliancesAllianceIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdPath: z.ZodObject<{
    alliance_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetAlliancesAllianceIdResponse: z.ZodObject<{
    creator_corporation_id: z.ZodInt;
    creator_id: z.ZodInt;
    date_founded: z.ZodISODateTime;
    executor_corporation_id: z.ZodOptional<z.ZodInt>;
    faction_id: z.ZodOptional<z.ZodInt>;
    name: z.ZodString;
    ticker: z.ZodString;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdContactsPath: z.ZodObject<{
    alliance_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdContactsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetAlliancesAllianceIdContactsResponse: z.ZodArray<z.ZodObject<{
    contact_id: z.ZodInt;
    contact_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
    }>;
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetAlliancesAllianceIdContactsLabelsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdContactsLabelsPath: z.ZodObject<{
    alliance_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetAlliancesAllianceIdContactsLabelsResponse: z.ZodArray<z.ZodObject<{
    label_id: z.ZodInt;
    label_name: z.ZodString;
}, z.core.$loose>>;
export declare const zGetAlliancesAllianceIdCorporationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdCorporationsPath: z.ZodObject<{
    alliance_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetAlliancesAllianceIdCorporationsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetAlliancesAllianceIdIconsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetAlliancesAllianceIdIconsPath: z.ZodObject<{
    alliance_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetAlliancesAllianceIdIconsResponse: z.ZodObject<{
    px128x128: z.ZodOptional<z.ZodString>;
    px64x64: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersAffiliationBody: z.ZodArray<z.ZodInt>;
export declare const zPostCharactersAffiliationHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostCharactersAffiliationResponse: z.ZodArray<z.ZodObject<{
    alliance_id: z.ZodOptional<z.ZodInt>;
    character_id: z.ZodInt;
    corporation_id: z.ZodInt;
    faction_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCharactersDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersDetailPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersDetailResponse: z.ZodObject<{
    achievement_score: z.ZodInt;
    alliance_id: z.ZodOptional<z.ZodInt>;
    birthday: z.ZodISODateTime;
    bloodline_id: z.ZodInt;
    character_title_id: z.ZodOptional<z.ZodUUID>;
    corporation_id: z.ZodInt;
    corporation_title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    faction_id: z.ZodOptional<z.ZodInt>;
    gender: z.ZodEnum<{
        female: "female";
        male: "male";
    }>;
    name: z.ZodString;
    race_id: z.ZodInt;
    security_status: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const zGetCharactersAccessListsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersAccessListsListingPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersAccessListsListingResponse: z.ZodObject<{
    access_lists: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersAccessListsDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersAccessListsDetailPath: z.ZodObject<{
    access_list_id: z.ZodInt;
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersAccessListsDetailResponse: z.ZodObject<{
    description: z.ZodString;
    id: z.ZodInt;
    membership: z.ZodObject<{
        alliances: z.ZodArray<z.ZodObject<{
            access: z.ZodEnum<{
                Admin: "Admin";
                Allowed: "Allowed";
                Blocked: "Blocked";
                Manager: "Manager";
                Unspecified: "Unspecified";
            }>;
            alliance_id: z.ZodInt;
        }, z.core.$loose>>;
        allow_everyone: z.ZodBoolean;
        characters: z.ZodArray<z.ZodObject<{
            access: z.ZodEnum<{
                Admin: "Admin";
                Allowed: "Allowed";
                Blocked: "Blocked";
                Manager: "Manager";
                Unspecified: "Unspecified";
            }>;
            character_id: z.ZodInt;
        }, z.core.$loose>>;
        corporations: z.ZodArray<z.ZodObject<{
            access: z.ZodEnum<{
                Admin: "Admin";
                Allowed: "Allowed";
                Blocked: "Blocked";
                Manager: "Manager";
                Unspecified: "Unspecified";
            }>;
            corporation_id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdAgentsResearchHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdAgentsResearchPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdAgentsResearchResponse: z.ZodArray<z.ZodObject<{
    agent_id: z.ZodInt;
    points_per_day: z.ZodNumber;
    remainder_points: z.ZodNumber;
    skill_type_id: z.ZodInt;
    started_at: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdAssetsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdAssetsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdAssetsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdAssetsResponse: z.ZodArray<z.ZodObject<{
    is_blueprint_copy: z.ZodOptional<z.ZodBoolean>;
    is_singleton: z.ZodBoolean;
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        BoosterBay: "BoosterBay";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CorpseBay: "CorpseBay";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        InfrastructureHangar: "InfrastructureHangar";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        QuafeBay: "QuafeBay";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        ShipHangar: "ShipHangar";
        Skill: "Skill";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureDeedBay: "StructureDeedBay";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    location_type: z.ZodEnum<{
        item: "item";
        other: "other";
        solar_system: "solar_system";
        station: "station";
    }>;
    quantity: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zPostCharactersCharacterIdAssetsLocationsBody: z.ZodArray<z.ZodInt>;
export declare const zPostCharactersCharacterIdAssetsLocationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdAssetsLocationsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostCharactersCharacterIdAssetsLocationsResponse: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
}, z.core.$loose>>;
export declare const zPostCharactersCharacterIdAssetsNamesBody: z.ZodArray<z.ZodInt>;
export declare const zPostCharactersCharacterIdAssetsNamesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdAssetsNamesPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostCharactersCharacterIdAssetsNamesResponse: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdAttributesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdAttributesPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdAttributesResponse: z.ZodObject<{
    accrued_remap_cooldown_date: z.ZodOptional<z.ZodISODateTime>;
    bonus_remaps: z.ZodOptional<z.ZodInt>;
    charisma: z.ZodInt;
    intelligence: z.ZodInt;
    last_remap_date: z.ZodOptional<z.ZodISODateTime>;
    memory: z.ZodInt;
    perception: z.ZodInt;
    willpower: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdBlueprintsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdBlueprintsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdBlueprintsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdBlueprintsResponse: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Cargo: "Cargo";
        CorpseBay: "CorpseBay";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        Module: "Module";
        QuafeBay: "QuafeBay";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        ShipHangar: "ShipHangar";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
    }>;
    location_id: z.ZodInt;
    material_efficiency: z.ZodInt;
    quantity: z.ZodInt;
    runs: z.ZodInt;
    time_efficiency: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdCalendarHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdCalendarPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdCalendarQuery: z.ZodObject<{
    from_event: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdCalendarResponse: z.ZodArray<z.ZodObject<{
    event_date: z.ZodOptional<z.ZodISODateTime>;
    event_id: z.ZodOptional<z.ZodInt>;
    event_response: z.ZodOptional<z.ZodEnum<{
        accepted: "accepted";
        declined: "declined";
        not_responded: "not_responded";
        tentative: "tentative";
    }>>;
    importance: z.ZodOptional<z.ZodInt>;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdCalendarEventIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdCalendarEventIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    event_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdCalendarEventIdResponse: z.ZodObject<{
    date: z.ZodISODateTime;
    duration: z.ZodInt;
    event_id: z.ZodInt;
    importance: z.ZodInt;
    owner_id: z.ZodInt;
    owner_name: z.ZodString;
    owner_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        eve_server: "eve_server";
        faction: "faction";
    }>;
    response: z.ZodString;
    text: z.ZodString;
    title: z.ZodString;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdCalendarEventIdBody: z.ZodObject<{
    response: z.ZodEnum<{
        accepted: "accepted";
        declined: "declined";
        tentative: "tentative";
    }>;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdCalendarEventIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdCalendarEventIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    event_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Event updated
 */
export declare const zPutCharactersCharacterIdCalendarEventIdResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdCalendarEventIdAttendeesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdCalendarEventIdAttendeesPath: z.ZodObject<{
    character_id: z.ZodInt;
    event_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdCalendarEventIdAttendeesResponse: z.ZodArray<z.ZodObject<{
    character_id: z.ZodOptional<z.ZodInt>;
    event_response: z.ZodOptional<z.ZodEnum<{
        accepted: "accepted";
        declined: "declined";
        not_responded: "not_responded";
        tentative: "tentative";
    }>>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdClonesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdClonesPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdClonesResponse: z.ZodObject<{
    home_location: z.ZodOptional<z.ZodObject<{
        location_id: z.ZodOptional<z.ZodInt>;
        location_type: z.ZodOptional<z.ZodEnum<{
            station: "station";
            structure: "structure";
        }>>;
    }, z.core.$loose>>;
    jump_clones: z.ZodArray<z.ZodObject<{
        implants: z.ZodArray<z.ZodInt>;
        jump_clone_id: z.ZodInt;
        location_id: z.ZodInt;
        location_type: z.ZodEnum<{
            station: "station";
            structure: "structure";
        }>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    last_clone_jump_date: z.ZodOptional<z.ZodISODateTime>;
    last_station_change_date: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdContactsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdContactsQuery: z.ZodObject<{
    contact_ids: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
/**
 * Contacts deleted
 */
export declare const zDeleteCharactersCharacterIdContactsResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContactsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContactsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdContactsResponse: z.ZodArray<z.ZodObject<{
    contact_id: z.ZodInt;
    contact_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
    }>;
    is_blocked: z.ZodOptional<z.ZodBoolean>;
    is_watched: z.ZodOptional<z.ZodBoolean>;
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zPostCharactersCharacterIdContactsBody: z.ZodArray<z.ZodInt>;
export declare const zPostCharactersCharacterIdContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdContactsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdContactsQuery: z.ZodObject<{
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
    watched: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostCharactersCharacterIdContactsResponse: z.ZodArray<z.ZodInt>;
export declare const zPutCharactersCharacterIdContactsBody: z.ZodArray<z.ZodInt>;
export declare const zPutCharactersCharacterIdContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdContactsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdContactsQuery: z.ZodObject<{
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
    watched: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$loose>;
/**
 * Contacts updated
 */
export declare const zPutCharactersCharacterIdContactsResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdContactsLabelsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContactsLabelsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdContactsLabelsResponse: z.ZodArray<z.ZodObject<{
    label_id: z.ZodInt;
    label_name: z.ZodString;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdContractsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContractsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContractsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdContractsResponse: z.ZodArray<z.ZodObject<{
    acceptor_id: z.ZodInt;
    assignee_id: z.ZodInt;
    availability: z.ZodEnum<{
        alliance: "alliance";
        corporation: "corporation";
        personal: "personal";
        public: "public";
    }>;
    buyout: z.ZodOptional<z.ZodNumber>;
    collateral: z.ZodOptional<z.ZodNumber>;
    contract_id: z.ZodInt;
    date_accepted: z.ZodOptional<z.ZodISODateTime>;
    date_completed: z.ZodOptional<z.ZodISODateTime>;
    date_expired: z.ZodISODateTime;
    date_issued: z.ZodISODateTime;
    days_to_complete: z.ZodOptional<z.ZodInt>;
    end_location_id: z.ZodOptional<z.ZodInt>;
    for_corporation: z.ZodBoolean;
    issuer_corporation_id: z.ZodInt;
    issuer_id: z.ZodInt;
    price: z.ZodOptional<z.ZodNumber>;
    reward: z.ZodOptional<z.ZodNumber>;
    start_location_id: z.ZodOptional<z.ZodInt>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        deleted: "deleted";
        failed: "failed";
        finished: "finished";
        finished_contractor: "finished_contractor";
        finished_issuer: "finished_issuer";
        in_progress: "in_progress";
        outstanding: "outstanding";
        rejected: "rejected";
        reversed: "reversed";
    }>;
    title: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        auction: "auction";
        courier: "courier";
        item_exchange: "item_exchange";
        loan: "loan";
        unknown: "unknown";
    }>;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdContractsContractIdBidsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContractsContractIdBidsPath: z.ZodObject<{
    character_id: z.ZodInt;
    contract_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdContractsContractIdBidsResponse: z.ZodArray<z.ZodObject<{
    amount: z.ZodNumber;
    bid_id: z.ZodInt;
    bidder_id: z.ZodInt;
    date_bid: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdContractsContractIdItemsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdContractsContractIdItemsPath: z.ZodObject<{
    character_id: z.ZodInt;
    contract_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdContractsContractIdItemsResponse: z.ZodArray<z.ZodObject<{
    is_included: z.ZodBoolean;
    is_singleton: z.ZodBoolean;
    quantity: z.ZodInt;
    raw_quantity: z.ZodOptional<z.ZodInt>;
    record_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdCorporationhistoryHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdCorporationhistoryPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdCorporationhistoryResponse: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    is_deleted: z.ZodOptional<z.ZodBoolean>;
    record_id: z.ZodInt;
    start_date: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zGetCharactersCosmeticsSkinrHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCosmeticsSkinrPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCosmeticsSkinrResponse: z.ZodObject<{
    licenses: z.ZodArray<z.ZodObject<{
        activated: z.ZodBoolean;
        skinr_id: z.ZodString;
        unactivated: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersCosmeticsSkinrComponentsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCosmeticsSkinrComponentsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCosmeticsSkinrComponentsResponse: z.ZodObject<{
    licenses: z.ZodArray<z.ZodObject<{
        component_id: z.ZodInt;
        runs: z.ZodXor<readonly [z.ZodObject<{
            remaining: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            unlimited: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>]>;
        type: z.ZodEnum<{
            nanocoating: "nanocoating";
            pattern: "pattern";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdCspaBody: z.ZodArray<z.ZodInt>;
export declare const zPostCharactersCharacterIdCspaHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdCspaPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostCharactersCharacterIdCspaResponse: z.ZodNumber;
export declare const zGetCharactersCharacterIdFatigueHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdFatiguePath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdFatigueResponse: z.ZodObject<{
    jump_fatigue_expire_date: z.ZodOptional<z.ZodISODateTime>;
    last_jump_date: z.ZodOptional<z.ZodISODateTime>;
    last_update_date: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdFittingsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdFittingsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdFittingsResponse: z.ZodArray<z.ZodObject<{
    description: z.ZodString;
    fitting_id: z.ZodInt;
    items: z.ZodArray<z.ZodObject<{
        flag: z.ZodEnum<{
            Cargo: "Cargo";
            DroneBay: "DroneBay";
            FighterBay: "FighterBay";
            HiSlot0: "HiSlot0";
            HiSlot1: "HiSlot1";
            HiSlot2: "HiSlot2";
            HiSlot3: "HiSlot3";
            HiSlot4: "HiSlot4";
            HiSlot5: "HiSlot5";
            HiSlot6: "HiSlot6";
            HiSlot7: "HiSlot7";
            Invalid: "Invalid";
            LoSlot0: "LoSlot0";
            LoSlot1: "LoSlot1";
            LoSlot2: "LoSlot2";
            LoSlot3: "LoSlot3";
            LoSlot4: "LoSlot4";
            LoSlot5: "LoSlot5";
            LoSlot6: "LoSlot6";
            LoSlot7: "LoSlot7";
            MedSlot0: "MedSlot0";
            MedSlot1: "MedSlot1";
            MedSlot2: "MedSlot2";
            MedSlot3: "MedSlot3";
            MedSlot4: "MedSlot4";
            MedSlot5: "MedSlot5";
            MedSlot6: "MedSlot6";
            MedSlot7: "MedSlot7";
            RigSlot0: "RigSlot0";
            RigSlot1: "RigSlot1";
            RigSlot2: "RigSlot2";
            ServiceSlot0: "ServiceSlot0";
            ServiceSlot1: "ServiceSlot1";
            ServiceSlot2: "ServiceSlot2";
            ServiceSlot3: "ServiceSlot3";
            ServiceSlot4: "ServiceSlot4";
            ServiceSlot5: "ServiceSlot5";
            ServiceSlot6: "ServiceSlot6";
            ServiceSlot7: "ServiceSlot7";
            SubSystemSlot0: "SubSystemSlot0";
            SubSystemSlot1: "SubSystemSlot1";
            SubSystemSlot2: "SubSystemSlot2";
            SubSystemSlot3: "SubSystemSlot3";
        }>;
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    name: z.ZodString;
    ship_type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zPostCharactersCharacterIdFittingsBody: z.ZodObject<{
    description: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        flag: z.ZodEnum<{
            Cargo: "Cargo";
            DroneBay: "DroneBay";
            FighterBay: "FighterBay";
            HiSlot0: "HiSlot0";
            HiSlot1: "HiSlot1";
            HiSlot2: "HiSlot2";
            HiSlot3: "HiSlot3";
            HiSlot4: "HiSlot4";
            HiSlot5: "HiSlot5";
            HiSlot6: "HiSlot6";
            HiSlot7: "HiSlot7";
            Invalid: "Invalid";
            LoSlot0: "LoSlot0";
            LoSlot1: "LoSlot1";
            LoSlot2: "LoSlot2";
            LoSlot3: "LoSlot3";
            LoSlot4: "LoSlot4";
            LoSlot5: "LoSlot5";
            LoSlot6: "LoSlot6";
            LoSlot7: "LoSlot7";
            MedSlot0: "MedSlot0";
            MedSlot1: "MedSlot1";
            MedSlot2: "MedSlot2";
            MedSlot3: "MedSlot3";
            MedSlot4: "MedSlot4";
            MedSlot5: "MedSlot5";
            MedSlot6: "MedSlot6";
            MedSlot7: "MedSlot7";
            RigSlot0: "RigSlot0";
            RigSlot1: "RigSlot1";
            RigSlot2: "RigSlot2";
            ServiceSlot0: "ServiceSlot0";
            ServiceSlot1: "ServiceSlot1";
            ServiceSlot2: "ServiceSlot2";
            ServiceSlot3: "ServiceSlot3";
            ServiceSlot4: "ServiceSlot4";
            ServiceSlot5: "ServiceSlot5";
            ServiceSlot6: "ServiceSlot6";
            ServiceSlot7: "ServiceSlot7";
            SubSystemSlot0: "SubSystemSlot0";
            SubSystemSlot1: "SubSystemSlot1";
            SubSystemSlot2: "SubSystemSlot2";
            SubSystemSlot3: "SubSystemSlot3";
        }>;
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    name: z.ZodString;
    ship_type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdFittingsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdFittingsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostCharactersCharacterIdFittingsResponse: z.ZodObject<{
    fitting_id: z.ZodInt;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdFittingsFittingIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdFittingsFittingIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    fitting_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Fitting deleted
 */
export declare const zDeleteCharactersCharacterIdFittingsFittingIdResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdFleetHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdFleetPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdFleetResponse: z.ZodObject<{
    fleet_boss_id: z.ZodInt;
    fleet_id: z.ZodInt;
    role: z.ZodEnum<{
        fleet_commander: "fleet_commander";
        squad_commander: "squad_commander";
        squad_member: "squad_member";
        wing_commander: "wing_commander";
    }>;
    squad_id: z.ZodInt;
    wing_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersFreelanceJobsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersFreelanceJobsListingPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersFreelanceJobsListingResponse: z.ZodObject<{
    freelance_jobs: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersFreelanceJobsParticipationHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersFreelanceJobsParticipationPath: z.ZodObject<{
    character_id: z.ZodInt;
    job_id: z.ZodUUID;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersFreelanceJobsParticipationResponse: z.ZodObject<{
    contributed: z.ZodInt;
    last_modified: z.ZodISODateTime;
    state: z.ZodEnum<{
        Committed: "Committed";
        Kicked: "Kicked";
        Resigned: "Resigned";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdFwStatsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdFwStatsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdFwStatsResponse: z.ZodObject<{
    current_rank: z.ZodOptional<z.ZodInt>;
    enlisted_on: z.ZodOptional<z.ZodISODateTime>;
    faction_id: z.ZodOptional<z.ZodInt>;
    highest_rank: z.ZodOptional<z.ZodInt>;
    kills: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdImplantsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdImplantsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdImplantsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetCharactersCharacterIdIndustryJobsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdIndustryJobsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdIndustryJobsQuery: z.ZodObject<{
    include_completed: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdIndustryJobsResponse: z.ZodArray<z.ZodObject<{
    activity_id: z.ZodInt;
    blueprint_id: z.ZodInt;
    blueprint_location_id: z.ZodInt;
    blueprint_type_id: z.ZodInt;
    completed_character_id: z.ZodOptional<z.ZodInt>;
    completed_date: z.ZodOptional<z.ZodISODateTime>;
    cost: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodInt;
    end_date: z.ZodISODateTime;
    facility_id: z.ZodInt;
    installer_id: z.ZodInt;
    job_id: z.ZodInt;
    licensed_runs: z.ZodOptional<z.ZodInt>;
    output_location_id: z.ZodInt;
    pause_date: z.ZodOptional<z.ZodISODateTime>;
    probability: z.ZodOptional<z.ZodNumber>;
    product_type_id: z.ZodOptional<z.ZodInt>;
    runs: z.ZodInt;
    start_date: z.ZodISODateTime;
    station_id: z.ZodInt;
    status: z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        delivered: "delivered";
        paused: "paused";
        ready: "ready";
        reverted: "reverted";
    }>;
    successful_runs: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdKillmailsRecentHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdKillmailsRecentPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdKillmailsRecentQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdKillmailsRecentResponse: z.ZodArray<z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdLocationHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdLocationPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdLocationResponse: z.ZodObject<{
    solar_system_id: z.ZodInt;
    station_id: z.ZodOptional<z.ZodInt>;
    structure_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdLoyaltyPointsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdLoyaltyPointsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdLoyaltyPointsResponse: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    loyalty_points: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdMailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMailPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMailQuery: z.ZodObject<{
    labels: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    last_mail_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdMailResponse: z.ZodArray<z.ZodObject<{
    from: z.ZodOptional<z.ZodInt>;
    is_read: z.ZodOptional<z.ZodBoolean>;
    labels: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    mail_id: z.ZodOptional<z.ZodInt>;
    recipients: z.ZodOptional<z.ZodArray<z.ZodObject<{
        recipient_id: z.ZodInt;
        recipient_type: z.ZodEnum<{
            alliance: "alliance";
            character: "character";
            corporation: "corporation";
            mailing_list: "mailing_list";
        }>;
    }, z.core.$loose>>>;
    subject: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zPostCharactersCharacterIdMailBody: z.ZodObject<{
    approved_cost: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
    body: z.ZodString;
    recipients: z.ZodArray<z.ZodObject<{
        recipient_id: z.ZodInt;
        recipient_type: z.ZodEnum<{
            alliance: "alliance";
            character: "character";
            corporation: "corporation";
            mailing_list: "mailing_list";
        }>;
    }, z.core.$loose>>;
    subject: z.ZodString;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdMailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdMailPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostCharactersCharacterIdMailResponse: z.ZodInt;
export declare const zGetCharactersCharacterIdMailLabelsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMailLabelsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdMailLabelsResponse: z.ZodObject<{
    labels: z.ZodOptional<z.ZodArray<z.ZodObject<{
        color: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            "#0000fe": "#0000fe";
            "#006634": "#006634";
            "#0099ff": "#0099ff";
            "#00ff33": "#00ff33";
            "#01ffff": "#01ffff";
            "#349800": "#349800";
            "#660066": "#660066";
            "#666666": "#666666";
            "#999999": "#999999";
            "#99ffff": "#99ffff";
            "#9a0000": "#9a0000";
            "#ccff9a": "#ccff9a";
            "#e6e6e6": "#e6e6e6";
            "#fe0000": "#fe0000";
            "#ff6600": "#ff6600";
            "#ffff01": "#ffff01";
            "#ffffcd": "#ffffcd";
            "#ffffff": "#ffffff";
        }>>>;
        label_id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
        unread_count: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    total_unread_count: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdMailLabelsBody: z.ZodObject<{
    color: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        "#0000fe": "#0000fe";
        "#006634": "#006634";
        "#0099ff": "#0099ff";
        "#00ff33": "#00ff33";
        "#01ffff": "#01ffff";
        "#349800": "#349800";
        "#660066": "#660066";
        "#666666": "#666666";
        "#999999": "#999999";
        "#99ffff": "#99ffff";
        "#9a0000": "#9a0000";
        "#ccff9a": "#ccff9a";
        "#e6e6e6": "#e6e6e6";
        "#fe0000": "#fe0000";
        "#ff6600": "#ff6600";
        "#ffff01": "#ffff01";
        "#ffffcd": "#ffffcd";
        "#ffffff": "#ffffff";
    }>>>;
    name: z.ZodString;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdMailLabelsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCharactersCharacterIdMailLabelsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostCharactersCharacterIdMailLabelsResponse: z.ZodInt;
export declare const zDeleteCharactersCharacterIdMailLabelsLabelIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdMailLabelsLabelIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    label_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Label deleted
 */
export declare const zDeleteCharactersCharacterIdMailLabelsLabelIdResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdMailListsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMailListsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdMailListsResponse: z.ZodArray<z.ZodObject<{
    mailing_list_id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zDeleteCharactersCharacterIdMailMailIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteCharactersCharacterIdMailMailIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    mail_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Mail deleted
 */
export declare const zDeleteCharactersCharacterIdMailMailIdResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdMailMailIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMailMailIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    mail_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdMailMailIdResponse: z.ZodObject<{
    body: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodInt>;
    labels: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    read: z.ZodOptional<z.ZodBoolean>;
    recipients: z.ZodOptional<z.ZodArray<z.ZodObject<{
        recipient_id: z.ZodInt;
        recipient_type: z.ZodEnum<{
            alliance: "alliance";
            character: "character";
            corporation: "corporation";
            mailing_list: "mailing_list";
        }>;
    }, z.core.$loose>>>;
    subject: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdMailMailIdBody: z.ZodObject<{
    labels: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    read: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdMailMailIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutCharactersCharacterIdMailMailIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    mail_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Mail updated
 */
export declare const zPutCharactersCharacterIdMailMailIdResponse: z.ZodUndefined;
export declare const zGetCharactersCharacterIdMedalsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMedalsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdMedalsResponse: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    date: z.ZodISODateTime;
    description: z.ZodString;
    graphics: z.ZodArray<z.ZodObject<{
        color: z.ZodOptional<z.ZodInt>;
        graphic: z.ZodString;
        layer: z.ZodInt;
        part: z.ZodInt;
    }, z.core.$loose>>;
    issuer_id: z.ZodInt;
    medal_id: z.ZodInt;
    reason: z.ZodString;
    status: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
    title: z.ZodString;
}, z.core.$loose>>;
export declare const zGetCharactersMercenaryTacticalOperationsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersMercenaryTacticalOperationsListingPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersMercenaryTacticalOperationsListingResponse: z.ZodObject<{
    operations: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        mercenary_den_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersMercenaryTacticalOperationsDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersMercenaryTacticalOperationsDetailPath: z.ZodObject<{
    operation_id: z.ZodUUID;
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersMercenaryTacticalOperationsDetailResponse: z.ZodObject<{
    dungeon_type_id: z.ZodInt;
    expires: z.ZodISODateTime;
    id: z.ZodUUID;
    mercenary_den_id: z.ZodInt;
    state: z.ZodEnum<{
        Available: "Available";
        Completed: "Completed";
        Expired: "Expired";
        Removed: "Removed";
        Started: "Started";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zGetCharactersMilitaryCampaignsObjectivesListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersMilitaryCampaignsObjectivesListingPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersMilitaryCampaignsObjectivesListingQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersMilitaryCampaignsObjectivesListingResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    objectives: z.ZodArray<z.ZodObject<{
        campaign_id: z.ZodUUID;
        contributed: z.ZodInt;
        id: z.ZodUUID;
        is_committed: z.ZodBoolean;
        last_modified: z.ZodISODateTime;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersMilitaryCampaignsObjectivesParticipationHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersMilitaryCampaignsObjectivesParticipationPath: z.ZodObject<{
    character_id: z.ZodInt;
    objective_id: z.ZodUUID;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersMilitaryCampaignsObjectivesParticipationResponse: z.ZodObject<{
    campaign_id: z.ZodUUID;
    contributed: z.ZodInt;
    id: z.ZodUUID;
    is_committed: z.ZodBoolean;
    last_modified: z.ZodISODateTime;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMiningHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMiningPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdMiningQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdMiningResponse: z.ZodArray<z.ZodObject<{
    date: z.ZodISODate;
    quantity: z.ZodInt;
    solar_system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdNotificationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdNotificationsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdNotificationsResponse: z.ZodArray<z.ZodObject<{
    is_read: z.ZodOptional<z.ZodBoolean>;
    notification_id: z.ZodInt;
    sender_id: z.ZodInt;
    sender_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
        other: "other";
    }>;
    text: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodISODateTime;
    type: z.ZodEnum<{
        AcceptedAlly: "AcceptedAlly";
        AcceptedSurrender: "AcceptedSurrender";
        AgentRetiredTrigravian: "AgentRetiredTrigravian";
        AllAnchoringMsg: "AllAnchoringMsg";
        AllMaintenanceBillMsg: "AllMaintenanceBillMsg";
        AllStrucInvulnerableMsg: "AllStrucInvulnerableMsg";
        AllStructVulnerableMsg: "AllStructVulnerableMsg";
        AllWarCorpJoinedAllianceMsg: "AllWarCorpJoinedAllianceMsg";
        AllWarDeclaredMsg: "AllWarDeclaredMsg";
        AllWarInvalidatedMsg: "AllWarInvalidatedMsg";
        AllWarRetractedMsg: "AllWarRetractedMsg";
        AllWarSurrenderMsg: "AllWarSurrenderMsg";
        AllianceCapitalChanged: "AllianceCapitalChanged";
        AllianceWarDeclaredV2: "AllianceWarDeclaredV2";
        AllyContractCancelled: "AllyContractCancelled";
        AllyJoinedWarAggressorMsg: "AllyJoinedWarAggressorMsg";
        AllyJoinedWarAllyMsg: "AllyJoinedWarAllyMsg";
        AllyJoinedWarDefenderMsg: "AllyJoinedWarDefenderMsg";
        BattlePunishFriendlyFire: "BattlePunishFriendlyFire";
        BillOutOfMoneyMsg: "BillOutOfMoneyMsg";
        BillPaidCorpAllMsg: "BillPaidCorpAllMsg";
        BountyClaimMsg: "BountyClaimMsg";
        BountyESSShared: "BountyESSShared";
        BountyESSTaken: "BountyESSTaken";
        BountyPlacedAlliance: "BountyPlacedAlliance";
        BountyPlacedChar: "BountyPlacedChar";
        BountyPlacedCorp: "BountyPlacedCorp";
        BountyYourBountyClaimed: "BountyYourBountyClaimed";
        BuddyConnectContactAdd: "BuddyConnectContactAdd";
        CharAppAcceptMsg: "CharAppAcceptMsg";
        CharAppRejectMsg: "CharAppRejectMsg";
        CharAppWithdrawMsg: "CharAppWithdrawMsg";
        CharLeftCorpMsg: "CharLeftCorpMsg";
        CharMedalMsg: "CharMedalMsg";
        CharTerminationMsg: "CharTerminationMsg";
        CloneActivationMsg: "CloneActivationMsg";
        CloneActivationMsg2: "CloneActivationMsg2";
        CloneMovedMsg: "CloneMovedMsg";
        CloneRevokedMsg1: "CloneRevokedMsg1";
        CloneRevokedMsg2: "CloneRevokedMsg2";
        CombatOperationFinished: "CombatOperationFinished";
        ContactAdd: "ContactAdd";
        ContactEdit: "ContactEdit";
        ContainerPasswordMsg: "ContainerPasswordMsg";
        ContractRegionChangedToPochven: "ContractRegionChangedToPochven";
        CorpAllBillMsg: "CorpAllBillMsg";
        CorpAppAcceptMsg: "CorpAppAcceptMsg";
        CorpAppInvitedMsg: "CorpAppInvitedMsg";
        CorpAppNewMsg: "CorpAppNewMsg";
        CorpAppRejectCustomMsg: "CorpAppRejectCustomMsg";
        CorpAppRejectMsg: "CorpAppRejectMsg";
        CorpBecameWarEligible: "CorpBecameWarEligible";
        CorpDividendMsg: "CorpDividendMsg";
        CorpFriendlyFireDisableTimerCompleted: "CorpFriendlyFireDisableTimerCompleted";
        CorpFriendlyFireDisableTimerStarted: "CorpFriendlyFireDisableTimerStarted";
        CorpFriendlyFireEnableTimerCompleted: "CorpFriendlyFireEnableTimerCompleted";
        CorpFriendlyFireEnableTimerStarted: "CorpFriendlyFireEnableTimerStarted";
        CorpKicked: "CorpKicked";
        CorpLiquidationMsg: "CorpLiquidationMsg";
        CorpNewCEOMsg: "CorpNewCEOMsg";
        CorpNewsMsg: "CorpNewsMsg";
        CorpNoLongerWarEligible: "CorpNoLongerWarEligible";
        CorpOfficeExpirationMsg: "CorpOfficeExpirationMsg";
        CorpStructLostMsg: "CorpStructLostMsg";
        CorpTaxChangeMsg: "CorpTaxChangeMsg";
        CorpVoteCEORevokedMsg: "CorpVoteCEORevokedMsg";
        CorpVoteMsg: "CorpVoteMsg";
        CorpWarDeclaredMsg: "CorpWarDeclaredMsg";
        CorpWarDeclaredV2: "CorpWarDeclaredV2";
        CorpWarFightingLegalMsg: "CorpWarFightingLegalMsg";
        CorpWarInvalidatedMsg: "CorpWarInvalidatedMsg";
        CorpWarRetractedMsg: "CorpWarRetractedMsg";
        CorpWarSurrenderMsg: "CorpWarSurrenderMsg";
        CorporationGoalClosed: "CorporationGoalClosed";
        CorporationGoalCompleted: "CorporationGoalCompleted";
        CorporationGoalCreated: "CorporationGoalCreated";
        CorporationGoalExpired: "CorporationGoalExpired";
        CorporationGoalLimitReached: "CorporationGoalLimitReached";
        CorporationGoalNameChange: "CorporationGoalNameChange";
        CorporationLeft: "CorporationLeft";
        CustomsMsg: "CustomsMsg";
        DailyItemRewardAutoClaimed: "DailyItemRewardAutoClaimed";
        DeclareWar: "DeclareWar";
        DistrictAttacked: "DistrictAttacked";
        DustAppAcceptedMsg: "DustAppAcceptedMsg";
        ESSMainBankLink: "ESSMainBankLink";
        EntosisCaptureStarted: "EntosisCaptureStarted";
        ExpertSystemExpired: "ExpertSystemExpired";
        ExpertSystemExpiryImminent: "ExpertSystemExpiryImminent";
        FWAllianceKickCeoIndividualStandingWarning: "FWAllianceKickCeoIndividualStandingWarning";
        FWAllianceKickMsg: "FWAllianceKickMsg";
        FWAllianceKickedCeoIndividualStanding: "FWAllianceKickedCeoIndividualStanding";
        FWAllianceWarningMsg: "FWAllianceWarningMsg";
        FWCharKickMsg: "FWCharKickMsg";
        FWCharRankGainMsg: "FWCharRankGainMsg";
        FWCharRankLossMsg: "FWCharRankLossMsg";
        FWCharWarningMsg: "FWCharWarningMsg";
        FWCharacterKickFromCorpIndividualStandingWarning: "FWCharacterKickFromCorpIndividualStandingWarning";
        FWCharacterKickedFromCorpIndividualStanding: "FWCharacterKickedFromCorpIndividualStanding";
        FWCorpJoinMsg: "FWCorpJoinMsg";
        FWCorpKickMsg: "FWCorpKickMsg";
        FWCorpLeaveMsg: "FWCorpLeaveMsg";
        FWCorpWarningMsg: "FWCorpWarningMsg";
        FWCorporationKickCeoIndividualStandingWarning: "FWCorporationKickCeoIndividualStandingWarning";
        FWCorporationKickedCeoIndividualStanding: "FWCorporationKickedCeoIndividualStanding";
        FacWarCorpJoinRequestMsg: "FacWarCorpJoinRequestMsg";
        FacWarCorpJoinWithdrawMsg: "FacWarCorpJoinWithdrawMsg";
        FacWarCorpLeaveRequestMsg: "FacWarCorpLeaveRequestMsg";
        FacWarCorpLeaveWithdrawMsg: "FacWarCorpLeaveWithdrawMsg";
        FacWarDirectEnlistmentRevoked: "FacWarDirectEnlistmentRevoked";
        FacWarLPDisqualifiedEvent: "FacWarLPDisqualifiedEvent";
        FacWarLPDisqualifiedKill: "FacWarLPDisqualifiedKill";
        FacWarLPPayoutEvent: "FacWarLPPayoutEvent";
        FacWarLPPayoutKill: "FacWarLPPayoutKill";
        FreelanceProjectACLDeleted: "FreelanceProjectACLDeleted";
        FreelanceProjectClosed: "FreelanceProjectClosed";
        FreelanceProjectCompleted: "FreelanceProjectCompleted";
        FreelanceProjectCreated: "FreelanceProjectCreated";
        FreelanceProjectExpired: "FreelanceProjectExpired";
        FreelanceProjectLimitReached: "FreelanceProjectLimitReached";
        FreelanceProjectParticipantKicked: "FreelanceProjectParticipantKicked";
        GameTimeAdded: "GameTimeAdded";
        GameTimeReceived: "GameTimeReceived";
        GameTimeSent: "GameTimeSent";
        GiftReceived: "GiftReceived";
        IHubDestroyedByBillFailure: "IHubDestroyedByBillFailure";
        IncursionCompletedMsg: "IncursionCompletedMsg";
        IndustryOperationFinished: "IndustryOperationFinished";
        IndustryTeamAuctionLost: "IndustryTeamAuctionLost";
        IndustryTeamAuctionWon: "IndustryTeamAuctionWon";
        InfrastructureHubBillAboutToExpire: "InfrastructureHubBillAboutToExpire";
        InsuranceExpirationMsg: "InsuranceExpirationMsg";
        InsuranceFirstShipMsg: "InsuranceFirstShipMsg";
        InsuranceInvalidatedMsg: "InsuranceInvalidatedMsg";
        InsuranceIssuedMsg: "InsuranceIssuedMsg";
        InsurancePayoutMsg: "InsurancePayoutMsg";
        InvasionCompletedMsg: "InvasionCompletedMsg";
        InvasionSystemLogin: "InvasionSystemLogin";
        InvasionSystemStart: "InvasionSystemStart";
        JumpCloneDeletedMsg1: "JumpCloneDeletedMsg1";
        JumpCloneDeletedMsg2: "JumpCloneDeletedMsg2";
        KillReportFinalBlow: "KillReportFinalBlow";
        KillReportVictim: "KillReportVictim";
        KillRightAvailable: "KillRightAvailable";
        KillRightAvailableOpen: "KillRightAvailableOpen";
        KillRightEarned: "KillRightEarned";
        KillRightUnavailable: "KillRightUnavailable";
        KillRightUnavailableOpen: "KillRightUnavailableOpen";
        KillRightUsed: "KillRightUsed";
        LPAutoRedeemed: "LPAutoRedeemed";
        LocateCharMsg: "LocateCharMsg";
        MadeWarMutual: "MadeWarMutual";
        MercOfferRetractedMsg: "MercOfferRetractedMsg";
        MercOfferedNegotiationMsg: "MercOfferedNegotiationMsg";
        MercenaryDenAttacked: "MercenaryDenAttacked";
        MercenaryDenNewMTO: "MercenaryDenNewMTO";
        MercenaryDenReinforced: "MercenaryDenReinforced";
        MissionCanceledTriglavian: "MissionCanceledTriglavian";
        MissionOfferExpirationMsg: "MissionOfferExpirationMsg";
        MissionTimeoutMsg: "MissionTimeoutMsg";
        MoonminingAutomaticFracture: "MoonminingAutomaticFracture";
        MoonminingExtractionCancelled: "MoonminingExtractionCancelled";
        MoonminingExtractionFinished: "MoonminingExtractionFinished";
        MoonminingExtractionStarted: "MoonminingExtractionStarted";
        MoonminingLaserFired: "MoonminingLaserFired";
        MutualWarExpired: "MutualWarExpired";
        MutualWarInviteAccepted: "MutualWarInviteAccepted";
        MutualWarInviteRejected: "MutualWarInviteRejected";
        MutualWarInviteSent: "MutualWarInviteSent";
        NPCStandingsGained: "NPCStandingsGained";
        NPCStandingsLost: "NPCStandingsLost";
        OfferToAllyRetracted: "OfferToAllyRetracted";
        OfferedSurrender: "OfferedSurrender";
        OfferedToAlly: "OfferedToAlly";
        OfficeLeaseCanceledInsufficientStandings: "OfficeLeaseCanceledInsufficientStandings";
        OldLscMessages: "OldLscMessages";
        OperationFinished: "OperationFinished";
        OrbitalAttacked: "OrbitalAttacked";
        OrbitalReinforced: "OrbitalReinforced";
        OwnershipTransferred: "OwnershipTransferred";
        RaffleCreated: "RaffleCreated";
        RaffleExpired: "RaffleExpired";
        RaffleFinished: "RaffleFinished";
        ReimbursementMsg: "ReimbursementMsg";
        ResearchMissionAvailableMsg: "ResearchMissionAvailableMsg";
        RetractsWar: "RetractsWar";
        SPAutoRedeemed: "SPAutoRedeemed";
        SeasonalChallengeCompleted: "SeasonalChallengeCompleted";
        SkinSequencingCompleted: "SkinSequencingCompleted";
        SkyhookDeployed: "SkyhookDeployed";
        SkyhookDestroyed: "SkyhookDestroyed";
        SkyhookLostShields: "SkyhookLostShields";
        SkyhookOnline: "SkyhookOnline";
        SkyhookUnderAttack: "SkyhookUnderAttack";
        SovAllClaimAquiredMsg: "SovAllClaimAquiredMsg";
        SovAllClaimLostMsg: "SovAllClaimLostMsg";
        SovCommandNodeEventStarted: "SovCommandNodeEventStarted";
        SovCorpBillLateMsg: "SovCorpBillLateMsg";
        SovCorpClaimFailMsg: "SovCorpClaimFailMsg";
        SovDisruptorMsg: "SovDisruptorMsg";
        SovStationEnteredFreeport: "SovStationEnteredFreeport";
        SovStructureDestroyed: "SovStructureDestroyed";
        SovStructureReinforced: "SovStructureReinforced";
        SovStructureSelfDestructCancel: "SovStructureSelfDestructCancel";
        SovStructureSelfDestructFinished: "SovStructureSelfDestructFinished";
        SovStructureSelfDestructRequested: "SovStructureSelfDestructRequested";
        SovereigntyIHDamageMsg: "SovereigntyIHDamageMsg";
        SovereigntySBUDamageMsg: "SovereigntySBUDamageMsg";
        SovereigntyTCUDamageMsg: "SovereigntyTCUDamageMsg";
        StationAggressionMsg1: "StationAggressionMsg1";
        StationAggressionMsg2: "StationAggressionMsg2";
        StationConquerMsg: "StationConquerMsg";
        StationServiceDisabled: "StationServiceDisabled";
        StationServiceEnabled: "StationServiceEnabled";
        StationStateChangeMsg: "StationStateChangeMsg";
        StoryLineMissionAvailableMsg: "StoryLineMissionAvailableMsg";
        StructureAnchoring: "StructureAnchoring";
        StructureCourierContractChanged: "StructureCourierContractChanged";
        StructureDestroyed: "StructureDestroyed";
        StructureFuelAlert: "StructureFuelAlert";
        StructureImpendingAbandonmentAssetsAtRisk: "StructureImpendingAbandonmentAssetsAtRisk";
        StructureItemsDelivered: "StructureItemsDelivered";
        StructureItemsMovedToSafety: "StructureItemsMovedToSafety";
        StructureLostArmor: "StructureLostArmor";
        StructureLostShields: "StructureLostShields";
        StructureLowReagentsAlert: "StructureLowReagentsAlert";
        StructureNoReagentsAlert: "StructureNoReagentsAlert";
        StructureOnline: "StructureOnline";
        StructurePaintPurchased: "StructurePaintPurchased";
        StructureServicesOffline: "StructureServicesOffline";
        StructureUnanchoring: "StructureUnanchoring";
        StructureUnderAttack: "StructureUnderAttack";
        StructureWentHighPower: "StructureWentHighPower";
        StructureWentLowPower: "StructureWentLowPower";
        StructuresJobsCancelled: "StructuresJobsCancelled";
        StructuresJobsPaused: "StructuresJobsPaused";
        StructuresReinforcementChanged: "StructuresReinforcementChanged";
        TowerAlertMsg: "TowerAlertMsg";
        TowerResourceAlertMsg: "TowerResourceAlertMsg";
        TransactionReversalMsg: "TransactionReversalMsg";
        TutorialMsg: "TutorialMsg";
        "WarAdopted ": "WarAdopted ";
        WarAllyInherited: "WarAllyInherited";
        WarAllyOfferDeclinedMsg: "WarAllyOfferDeclinedMsg";
        WarConcordInvalidates: "WarConcordInvalidates";
        WarDeclared: "WarDeclared";
        WarEndedHqSecurityDrop: "WarEndedHqSecurityDrop";
        WarHQRemovedFromSpace: "WarHQRemovedFromSpace";
        WarInherited: "WarInherited";
        WarInvalid: "WarInvalid";
        WarRetracted: "WarRetracted";
        WarRetractedByConcord: "WarRetractedByConcord";
        WarSurrenderDeclinedMsg: "WarSurrenderDeclinedMsg";
        WarSurrenderOfferMsg: "WarSurrenderOfferMsg";
    }>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdNotificationsContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdNotificationsContactsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdNotificationsContactsResponse: z.ZodArray<z.ZodObject<{
    message: z.ZodString;
    notification_id: z.ZodInt;
    send_date: z.ZodISODateTime;
    sender_character_id: z.ZodInt;
    standing_level: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdOnlineHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdOnlinePath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdOnlineResponse: z.ZodObject<{
    last_login: z.ZodOptional<z.ZodISODateTime>;
    last_logout: z.ZodOptional<z.ZodISODateTime>;
    logins: z.ZodOptional<z.ZodInt>;
    online: z.ZodBoolean;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdOrdersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdOrdersPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdOrdersResponse: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    is_corporation: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdOrdersHistoryHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdOrdersHistoryPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdOrdersHistoryQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdOrdersHistoryResponse: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    is_corporation: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    state: z.ZodEnum<{
        cancelled: "cancelled";
        expired: "expired";
    }>;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersParagonHubSkinrHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersParagonHubSkinrPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersParagonHubSkinrQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersParagonHubSkinrResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
        target: z.ZodXor<readonly [z.ZodObject<{
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            alliance_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>, z.ZodObject<{
            public: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>]>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdPlanetsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdPlanetsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdPlanetsResponse: z.ZodArray<z.ZodObject<{
    last_update: z.ZodISODateTime;
    num_pins: z.ZodInt;
    owner_id: z.ZodInt;
    planet_id: z.ZodInt;
    planet_type: z.ZodEnum<{
        barren: "barren";
        gas: "gas";
        ice: "ice";
        lava: "lava";
        oceanic: "oceanic";
        plasma: "plasma";
        storm: "storm";
        temperate: "temperate";
    }>;
    solar_system_id: z.ZodInt;
    upgrade_level: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdPlanetsPlanetIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdPlanetsPlanetIdPath: z.ZodObject<{
    character_id: z.ZodInt;
    planet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdPlanetsPlanetIdResponse: z.ZodObject<{
    links: z.ZodArray<z.ZodObject<{
        destination_pin_id: z.ZodInt;
        link_level: z.ZodInt;
        source_pin_id: z.ZodInt;
    }, z.core.$loose>>;
    pins: z.ZodArray<z.ZodObject<{
        contents: z.ZodOptional<z.ZodArray<z.ZodObject<{
            amount: z.ZodInt;
            type_id: z.ZodInt;
        }, z.core.$loose>>>;
        expiry_time: z.ZodOptional<z.ZodISODateTime>;
        extractor_details: z.ZodOptional<z.ZodObject<{
            cycle_time: z.ZodOptional<z.ZodInt>;
            head_radius: z.ZodOptional<z.ZodNumber>;
            heads: z.ZodArray<z.ZodObject<{
                head_id: z.ZodInt;
                latitude: z.ZodNumber;
                longitude: z.ZodNumber;
            }, z.core.$loose>>;
            product_type_id: z.ZodOptional<z.ZodInt>;
            qty_per_cycle: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        factory_details: z.ZodOptional<z.ZodObject<{
            schematic_id: z.ZodInt;
        }, z.core.$loose>>;
        install_time: z.ZodOptional<z.ZodISODateTime>;
        last_cycle_start: z.ZodOptional<z.ZodISODateTime>;
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
        pin_id: z.ZodInt;
        schematic_id: z.ZodOptional<z.ZodInt>;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    routes: z.ZodArray<z.ZodObject<{
        content_type_id: z.ZodInt;
        destination_pin_id: z.ZodInt;
        quantity: z.ZodNumber;
        route_id: z.ZodInt;
        source_pin_id: z.ZodInt;
        waypoints: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdPortraitHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdPortraitPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdPortraitResponse: z.ZodObject<{
    px128x128: z.ZodOptional<z.ZodString>;
    px256x256: z.ZodOptional<z.ZodString>;
    px512x512: z.ZodOptional<z.ZodString>;
    px64x64: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdRolesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdRolesPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdRolesResponse: z.ZodObject<{
    roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdSearchHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdSearchPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdSearchQuery: z.ZodObject<{
    categories: z.ZodArray<z.ZodEnum<{
        agent: "agent";
        alliance: "alliance";
        character: "character";
        constellation: "constellation";
        corporation: "corporation";
        faction: "faction";
        inventory_type: "inventory_type";
        region: "region";
        solar_system: "solar_system";
        station: "station";
        structure: "structure";
    }>>;
    search: z.ZodString;
    strict: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdSearchResponse: z.ZodObject<{
    agent: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    alliance: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    character: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    constellation: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    corporation: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    faction: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    inventory_type: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    region: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    solar_system: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    station: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    structure: z.ZodOptional<z.ZodArray<z.ZodInt>>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdShipHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdShipPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdShipResponse: z.ZodObject<{
    ship_item_id: z.ZodInt;
    ship_name: z.ZodString;
    ship_type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdSkillqueueHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdSkillqueuePath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdSkillqueueResponse: z.ZodArray<z.ZodObject<{
    finish_date: z.ZodOptional<z.ZodISODateTime>;
    finished_level: z.ZodInt;
    level_end_sp: z.ZodOptional<z.ZodInt>;
    level_start_sp: z.ZodOptional<z.ZodInt>;
    queue_position: z.ZodInt;
    skill_id: z.ZodInt;
    start_date: z.ZodOptional<z.ZodISODateTime>;
    training_start_sp: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdSkillsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdSkillsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdSkillsResponse: z.ZodObject<{
    skills: z.ZodArray<z.ZodObject<{
        active_skill_level: z.ZodInt;
        skill_id: z.ZodInt;
        skillpoints_in_skill: z.ZodInt;
        trained_skill_level: z.ZodInt;
    }, z.core.$loose>>;
    total_sp: z.ZodInt;
    unallocated_sp: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdStandingsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdStandingsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdStandingsResponse: z.ZodArray<z.ZodObject<{
    from_id: z.ZodInt;
    from_type: z.ZodEnum<{
        agent: "agent";
        faction: "faction";
        npc_corp: "npc_corp";
    }>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetCharactersStructuresMercenaryDensListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersStructuresMercenaryDensListingPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersStructuresMercenaryDensListingResponse: z.ZodObject<{
    mercenary_dens: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        planet_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCharactersStructuresMercenaryDensDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersStructuresMercenaryDensDetailPath: z.ZodObject<{
    mercenary_den_id: z.ZodInt;
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersStructuresMercenaryDensDetailResponse: z.ZodObject<{
    evolution: z.ZodObject<{
        anarchy: z.ZodObject<{
            amount: z.ZodInt;
            level: z.ZodEnum<{
                Level0: "Level0";
                Level1: "Level1";
                Level2: "Level2";
                Level3: "Level3";
                Level4: "Level4";
                Unspecified: "Unspecified";
            }>;
        }, z.core.$loose>;
        development: z.ZodObject<{
            amount: z.ZodInt;
            level: z.ZodEnum<{
                Level0: "Level0";
                Level1: "Level1";
                Level2: "Level2";
                Level3: "Level3";
                Level4: "Level4";
                Unspecified: "Unspecified";
            }>;
        }, z.core.$loose>;
    }, z.core.$loose>;
    id: z.ZodInt;
    infomorphs: z.ZodObject<{
        amount: z.ZodInt;
    }, z.core.$loose>;
    reinforcement_timer: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
    }, z.core.$loose>>;
    skyhook: z.ZodObject<{
        corporation_id: z.ZodInt;
        id: z.ZodInt;
        planet_id: z.ZodInt;
    }, z.core.$loose>;
    state: z.ZodEnum<{
        Disabled: "Disabled";
        Paused: "Paused";
        Running: "Running";
        Unspecified: "Unspecified";
    }>;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdTitlesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdTitlesPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdTitlesResponse: z.ZodArray<z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    title_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdWalletHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdWalletPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdWalletResponse: z.ZodNumber;
export declare const zGetCharactersCharacterIdWalletJournalHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdWalletJournalPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdWalletJournalQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdWalletJournalResponse: z.ZodArray<z.ZodObject<{
    amount: z.ZodOptional<z.ZodNumber>;
    balance: z.ZodOptional<z.ZodNumber>;
    context_id: z.ZodOptional<z.ZodInt>;
    context_id_type: z.ZodOptional<z.ZodEnum<{
        alliance_id: "alliance_id";
        character_id: "character_id";
        contract_id: "contract_id";
        corporation_id: "corporation_id";
        eve_system: "eve_system";
        industry_job_id: "industry_job_id";
        market_transaction_id: "market_transaction_id";
        planet_id: "planet_id";
        station_id: "station_id";
        structure_id: "structure_id";
        system_id: "system_id";
        type_id: "type_id";
    }>>;
    date: z.ZodISODateTime;
    description: z.ZodString;
    first_party_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    reason: z.ZodOptional<z.ZodString>;
    ref_type: z.ZodEnum<{
        acceleration_gate_fee: "acceleration_gate_fee";
        achievement_category_milestone_reward: "achievement_category_milestone_reward";
        achievement_milestone_reward: "achievement_milestone_reward";
        advertisement_listing_fee: "advertisement_listing_fee";
        agent_donation: "agent_donation";
        agent_location_services: "agent_location_services";
        agent_miscellaneous: "agent_miscellaneous";
        agent_mission_collateral_paid: "agent_mission_collateral_paid";
        agent_mission_collateral_refunded: "agent_mission_collateral_refunded";
        agent_mission_reward: "agent_mission_reward";
        agent_mission_reward_corporation_tax: "agent_mission_reward_corporation_tax";
        agent_mission_security_tax: "agent_mission_security_tax";
        agent_mission_time_bonus_reward: "agent_mission_time_bonus_reward";
        agent_mission_time_bonus_reward_corporation_tax: "agent_mission_time_bonus_reward_corporation_tax";
        agent_security_services: "agent_security_services";
        agent_services_rendered: "agent_services_rendered";
        agents_preward: "agents_preward";
        air_career_program_reward: "air_career_program_reward";
        alliance_maintainance_fee: "alliance_maintainance_fee";
        alliance_registration_fee: "alliance_registration_fee";
        allignment_based_gate_toll: "allignment_based_gate_toll";
        asset_safety_recovery_tax: "asset_safety_recovery_tax";
        bounty: "bounty";
        bounty_prize: "bounty_prize";
        bounty_prize_corporation_tax: "bounty_prize_corporation_tax";
        bounty_prizes: "bounty_prizes";
        bounty_reimbursement: "bounty_reimbursement";
        bounty_surcharge: "bounty_surcharge";
        brokers_fee: "brokers_fee";
        campaign_objective_isk_reward: "campaign_objective_isk_reward";
        clone_activation: "clone_activation";
        clone_transfer: "clone_transfer";
        contraband_fine: "contraband_fine";
        contract_auction_bid: "contract_auction_bid";
        contract_auction_bid_corp: "contract_auction_bid_corp";
        contract_auction_bid_refund: "contract_auction_bid_refund";
        contract_auction_sold: "contract_auction_sold";
        contract_brokers_fee: "contract_brokers_fee";
        contract_brokers_fee_corp: "contract_brokers_fee_corp";
        contract_collateral: "contract_collateral";
        contract_collateral_deposited_corp: "contract_collateral_deposited_corp";
        contract_collateral_payout: "contract_collateral_payout";
        contract_collateral_refund: "contract_collateral_refund";
        contract_deposit: "contract_deposit";
        contract_deposit_corp: "contract_deposit_corp";
        contract_deposit_refund: "contract_deposit_refund";
        contract_deposit_sales_tax: "contract_deposit_sales_tax";
        contract_price: "contract_price";
        contract_price_payment_corp: "contract_price_payment_corp";
        contract_reversal: "contract_reversal";
        contract_reward: "contract_reward";
        contract_reward_deposited: "contract_reward_deposited";
        contract_reward_deposited_corp: "contract_reward_deposited_corp";
        contract_reward_refund: "contract_reward_refund";
        contract_sales_tax: "contract_sales_tax";
        copying: "copying";
        corporate_reward_payout: "corporate_reward_payout";
        corporate_reward_tax: "corporate_reward_tax";
        corporation_account_withdrawal: "corporation_account_withdrawal";
        corporation_bulk_payment: "corporation_bulk_payment";
        corporation_dividend_payment: "corporation_dividend_payment";
        corporation_liquidation: "corporation_liquidation";
        corporation_logo_change_cost: "corporation_logo_change_cost";
        corporation_payment: "corporation_payment";
        corporation_registration_fee: "corporation_registration_fee";
        cosmetic_market_component_item_purchase: "cosmetic_market_component_item_purchase";
        cosmetic_market_skin_purchase: "cosmetic_market_skin_purchase";
        cosmetic_market_skin_sale: "cosmetic_market_skin_sale";
        cosmetic_market_skin_sale_broker_fee: "cosmetic_market_skin_sale_broker_fee";
        cosmetic_market_skin_sale_tax: "cosmetic_market_skin_sale_tax";
        cosmetic_market_skin_transaction: "cosmetic_market_skin_transaction";
        courier_mission_escrow: "courier_mission_escrow";
        cspa: "cspa";
        cspaofflinerefund: "cspaofflinerefund";
        daily_challenge_reward: "daily_challenge_reward";
        daily_goal_payouts: "daily_goal_payouts";
        daily_goal_payouts_tax: "daily_goal_payouts_tax";
        datacore_fee: "datacore_fee";
        dna_modification_fee: "dna_modification_fee";
        docking_fee: "docking_fee";
        duel_wager_escrow: "duel_wager_escrow";
        duel_wager_payment: "duel_wager_payment";
        duel_wager_refund: "duel_wager_refund";
        ess_escrow_transfer: "ess_escrow_transfer";
        external_trade_delivery: "external_trade_delivery";
        external_trade_freeze: "external_trade_freeze";
        external_trade_thaw: "external_trade_thaw";
        factory_slot_rental_fee: "factory_slot_rental_fee";
        flux_payout: "flux_payout";
        flux_tax: "flux_tax";
        flux_ticket_repayment: "flux_ticket_repayment";
        flux_ticket_sale: "flux_ticket_sale";
        freelance_jobs_broadcasting_fee: "freelance_jobs_broadcasting_fee";
        freelance_jobs_duration_fee: "freelance_jobs_duration_fee";
        freelance_jobs_escrow_refund: "freelance_jobs_escrow_refund";
        freelance_jobs_reward: "freelance_jobs_reward";
        freelance_jobs_reward_corporation_tax: "freelance_jobs_reward_corporation_tax";
        freelance_jobs_reward_escrow: "freelance_jobs_reward_escrow";
        gm_cash_transfer: "gm_cash_transfer";
        gm_plex_fee_refund: "gm_plex_fee_refund";
        industry_job_tax: "industry_job_tax";
        industry_security_tax: "industry_security_tax";
        infrastructure_hub_maintenance: "infrastructure_hub_maintenance";
        inheritance: "inheritance";
        insurance: "insurance";
        insurgency_corruption_contribution_reward: "insurgency_corruption_contribution_reward";
        insurgency_suppression_contribution_reward: "insurgency_suppression_contribution_reward";
        item_trader_payment: "item_trader_payment";
        jump_clone_activation_fee: "jump_clone_activation_fee";
        jump_clone_installation_fee: "jump_clone_installation_fee";
        kill_right_fee: "kill_right_fee";
        lp_store: "lp_store";
        manufacturing: "manufacturing";
        market_escrow: "market_escrow";
        market_fine_paid: "market_fine_paid";
        market_provider_tax: "market_provider_tax";
        market_security_tax: "market_security_tax";
        market_transaction: "market_transaction";
        medal_creation: "medal_creation";
        medal_issued: "medal_issued";
        milestone_reward_payment: "milestone_reward_payment";
        mission_completion: "mission_completion";
        mission_cost: "mission_cost";
        mission_expiration: "mission_expiration";
        mission_reward: "mission_reward";
        npc_bounty_security_tax: "npc_bounty_security_tax";
        office_rental_fee: "office_rental_fee";
        operation_bonus: "operation_bonus";
        opportunity_reward: "opportunity_reward";
        planetary_construction: "planetary_construction";
        planetary_export_tax: "planetary_export_tax";
        planetary_import_tax: "planetary_import_tax";
        player_donation: "player_donation";
        player_trading: "player_trading";
        project_discovery_reward: "project_discovery_reward";
        project_discovery_tax: "project_discovery_tax";
        project_payouts: "project_payouts";
        reaction: "reaction";
        redeemed_isk_token: "redeemed_isk_token";
        release_of_impounded_property: "release_of_impounded_property";
        repair_bill: "repair_bill";
        reprocessing_tax: "reprocessing_tax";
        researching_material_productivity: "researching_material_productivity";
        researching_technology: "researching_technology";
        researching_time_productivity: "researching_time_productivity";
        resource_wars_reward: "resource_wars_reward";
        reverse_engineering: "reverse_engineering";
        season_challenge_reward: "season_challenge_reward";
        security_processing_fee: "security_processing_fee";
        shares: "shares";
        skill_purchase: "skill_purchase";
        skyhook_claim_fee: "skyhook_claim_fee";
        sovereignity_bill: "sovereignity_bill";
        store_purchase: "store_purchase";
        store_purchase_refund: "store_purchase_refund";
        structure_gate_jump: "structure_gate_jump";
        transaction_tax: "transaction_tax";
        under_construction: "under_construction";
        upkeep_adjustment_fee: "upkeep_adjustment_fee";
        war_ally_contract: "war_ally_contract";
        war_fee: "war_fee";
        war_fee_surrender: "war_fee_surrender";
    }>;
    second_party_id: z.ZodOptional<z.ZodInt>;
    tax: z.ZodOptional<z.ZodNumber>;
    tax_receiver_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCharactersCharacterIdWalletTransactionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdWalletTransactionsPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCharactersCharacterIdWalletTransactionsQuery: z.ZodObject<{
    from_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCharactersCharacterIdWalletTransactionsResponse: z.ZodArray<z.ZodObject<{
    client_id: z.ZodInt;
    date: z.ZodISODateTime;
    is_buy: z.ZodBoolean;
    is_personal: z.ZodBoolean;
    journal_ref_id: z.ZodInt;
    location_id: z.ZodInt;
    quantity: z.ZodInt;
    transaction_id: z.ZodInt;
    type_id: z.ZodInt;
    unit_price: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetContractsPublicBidsContractIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetContractsPublicBidsContractIdPath: z.ZodObject<{
    contract_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetContractsPublicBidsContractIdQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetContractsPublicBidsContractIdResponse: z.ZodUnion<readonly [z.ZodArray<z.ZodObject<{
    amount: z.ZodNumber;
    bid_id: z.ZodInt;
    date_bid: z.ZodISODateTime;
}, z.core.$loose>>, z.ZodUndefined]>;
export declare const zGetContractsPublicItemsContractIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetContractsPublicItemsContractIdPath: z.ZodObject<{
    contract_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetContractsPublicItemsContractIdQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetContractsPublicItemsContractIdResponse: z.ZodUnion<readonly [z.ZodArray<z.ZodObject<{
    is_blueprint_copy: z.ZodOptional<z.ZodBoolean>;
    is_included: z.ZodBoolean;
    item_id: z.ZodOptional<z.ZodInt>;
    material_efficiency: z.ZodOptional<z.ZodInt>;
    quantity: z.ZodInt;
    record_id: z.ZodInt;
    runs: z.ZodOptional<z.ZodInt>;
    time_efficiency: z.ZodOptional<z.ZodInt>;
    type_id: z.ZodInt;
}, z.core.$loose>>, z.ZodUndefined]>;
export declare const zGetContractsPublicRegionIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetContractsPublicRegionIdPath: z.ZodObject<{
    region_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetContractsPublicRegionIdQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetContractsPublicRegionIdResponse: z.ZodArray<z.ZodObject<{
    buyout: z.ZodOptional<z.ZodNumber>;
    collateral: z.ZodOptional<z.ZodNumber>;
    contract_id: z.ZodInt;
    date_expired: z.ZodISODateTime;
    date_issued: z.ZodISODateTime;
    days_to_complete: z.ZodOptional<z.ZodInt>;
    end_location_id: z.ZodOptional<z.ZodInt>;
    for_corporation: z.ZodOptional<z.ZodBoolean>;
    issuer_corporation_id: z.ZodInt;
    issuer_id: z.ZodInt;
    price: z.ZodOptional<z.ZodNumber>;
    reward: z.ZodOptional<z.ZodNumber>;
    start_location_id: z.ZodOptional<z.ZodInt>;
    title: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        auction: "auction";
        courier: "courier";
        item_exchange: "item_exchange";
        loan: "loan";
        unknown: "unknown";
    }>;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>>;
export declare const zGetCorporationCorporationIdMiningExtractionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationCorporationIdMiningExtractionsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationCorporationIdMiningExtractionsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationCorporationIdMiningExtractionsResponse: z.ZodArray<z.ZodObject<{
    chunk_arrival_time: z.ZodISODateTime;
    extraction_start_time: z.ZodISODateTime;
    moon_id: z.ZodInt;
    natural_decay_time: z.ZodISODateTime;
    structure_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationCorporationIdMiningObserversHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationCorporationIdMiningObserversPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationCorporationIdMiningObserversQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationCorporationIdMiningObserversResponse: z.ZodArray<z.ZodObject<{
    last_updated: z.ZodISODate;
    observer_id: z.ZodInt;
    observer_type: z.ZodEnum<{
        structure: "structure";
    }>;
}, z.core.$loose>>;
export declare const zGetCorporationCorporationIdMiningObserversObserverIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationCorporationIdMiningObserversObserverIdPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    observer_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationCorporationIdMiningObserversObserverIdQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationCorporationIdMiningObserversObserverIdResponse: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    last_updated: z.ZodISODate;
    quantity: z.ZodInt;
    recorded_corporation_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsNpccorpsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsNpccorpsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetCorporationsCorporationIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdResponse: z.ZodObject<{
    alliance_id: z.ZodOptional<z.ZodInt>;
    ceo_id: z.ZodOptional<z.ZodInt>;
    creator_id: z.ZodOptional<z.ZodInt>;
    date_founded: z.ZodOptional<z.ZodISODateTime>;
    description: z.ZodString;
    enlisted_faction_id: z.ZodOptional<z.ZodInt>;
    friendly_fire: z.ZodEnum<{
        illegal: "illegal";
        legal: "legal";
    }>;
    home_station_id: z.ZodInt;
    member_count: z.ZodInt;
    name: z.ZodString;
    palette: z.ZodOptional<z.ZodObject<{
        main_color: z.ZodString;
        secondary_color: z.ZodOptional<z.ZodString>;
        tertiary_color: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    shares: z.ZodInt;
    state: z.ZodEnum<{
        active: "active";
        closed: "closed";
    }>;
    tax_rates: z.ZodObject<{
        isk: z.ZodNumber;
        loyalty_point: z.ZodNumber;
    }, z.core.$loose>;
    ticker: z.ZodString;
    type: z.ZodEnum<{
        npc_owned: "npc_owned";
        player_owned: "player_owned";
    }>;
    url: z.ZodOptional<z.ZodString>;
    war_eligible: z.ZodBoolean;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdAlliancehistoryHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdAlliancehistoryPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdAlliancehistoryResponse: z.ZodArray<z.ZodObject<{
    alliance_id: z.ZodOptional<z.ZodInt>;
    is_deleted: z.ZodOptional<z.ZodBoolean>;
    record_id: z.ZodInt;
    start_date: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdAssetsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdAssetsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdAssetsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdAssetsResponse: z.ZodArray<z.ZodObject<{
    is_blueprint_copy: z.ZodOptional<z.ZodBoolean>;
    is_singleton: z.ZodBoolean;
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Bonus: "Bonus";
        Booster: "Booster";
        BoosterBay: "BoosterBay";
        Capsule: "Capsule";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorpDeliveries: "CorpDeliveries";
        CorpSAG1: "CorpSAG1";
        CorpSAG2: "CorpSAG2";
        CorpSAG3: "CorpSAG3";
        CorpSAG4: "CorpSAG4";
        CorpSAG5: "CorpSAG5";
        CorpSAG6: "CorpSAG6";
        CorpSAG7: "CorpSAG7";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CrateLoot: "CrateLoot";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        DustBattle: "DustBattle";
        DustDatabank: "DustDatabank";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        Impounded: "Impounded";
        InfrastructureHangar: "InfrastructureHangar";
        JunkyardReprocessed: "JunkyardReprocessed";
        JunkyardTrashed: "JunkyardTrashed";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        OfficeFolder: "OfficeFolder";
        Pilot: "Pilot";
        PlanetSurface: "PlanetSurface";
        QuafeBay: "QuafeBay";
        QuantumCoreRoom: "QuantumCoreRoom";
        Reward: "Reward";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        SecondaryStorage: "SecondaryStorage";
        ServiceSlot0: "ServiceSlot0";
        ServiceSlot1: "ServiceSlot1";
        ServiceSlot2: "ServiceSlot2";
        ServiceSlot3: "ServiceSlot3";
        ServiceSlot4: "ServiceSlot4";
        ServiceSlot5: "ServiceSlot5";
        ServiceSlot6: "ServiceSlot6";
        ServiceSlot7: "ServiceSlot7";
        ShipHangar: "ShipHangar";
        ShipOffline: "ShipOffline";
        Skill: "Skill";
        SkillInTraining: "SkillInTraining";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureActive: "StructureActive";
        StructureFuel: "StructureFuel";
        StructureInactive: "StructureInactive";
        StructureOffline: "StructureOffline";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wallet: "Wallet";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    location_type: z.ZodEnum<{
        item: "item";
        other: "other";
        solar_system: "solar_system";
        station: "station";
    }>;
    quantity: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zPostCorporationsCorporationIdAssetsLocationsBody: z.ZodArray<z.ZodInt>;
export declare const zPostCorporationsCorporationIdAssetsLocationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCorporationsCorporationIdAssetsLocationsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostCorporationsCorporationIdAssetsLocationsResponse: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
}, z.core.$loose>>;
export declare const zPostCorporationsCorporationIdAssetsNamesBody: z.ZodArray<z.ZodInt>;
export declare const zPostCorporationsCorporationIdAssetsNamesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostCorporationsCorporationIdAssetsNamesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostCorporationsCorporationIdAssetsNamesResponse: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdBlueprintsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdBlueprintsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdBlueprintsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdBlueprintsResponse: z.ZodArray<z.ZodObject<{
    item_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Bonus: "Bonus";
        Booster: "Booster";
        BoosterBay: "BoosterBay";
        Capsule: "Capsule";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorpDeliveries: "CorpDeliveries";
        CorpSAG1: "CorpSAG1";
        CorpSAG2: "CorpSAG2";
        CorpSAG3: "CorpSAG3";
        CorpSAG4: "CorpSAG4";
        CorpSAG5: "CorpSAG5";
        CorpSAG6: "CorpSAG6";
        CorpSAG7: "CorpSAG7";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CrateLoot: "CrateLoot";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        DustBattle: "DustBattle";
        DustDatabank: "DustDatabank";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        Impounded: "Impounded";
        InfrastructureHangar: "InfrastructureHangar";
        JunkyardReprocessed: "JunkyardReprocessed";
        JunkyardTrashed: "JunkyardTrashed";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        OfficeFolder: "OfficeFolder";
        Pilot: "Pilot";
        PlanetSurface: "PlanetSurface";
        QuafeBay: "QuafeBay";
        QuantumCoreRoom: "QuantumCoreRoom";
        Reward: "Reward";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        SecondaryStorage: "SecondaryStorage";
        ServiceSlot0: "ServiceSlot0";
        ServiceSlot1: "ServiceSlot1";
        ServiceSlot2: "ServiceSlot2";
        ServiceSlot3: "ServiceSlot3";
        ServiceSlot4: "ServiceSlot4";
        ServiceSlot5: "ServiceSlot5";
        ServiceSlot6: "ServiceSlot6";
        ServiceSlot7: "ServiceSlot7";
        ShipHangar: "ShipHangar";
        ShipOffline: "ShipOffline";
        Skill: "Skill";
        SkillInTraining: "SkillInTraining";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureActive: "StructureActive";
        StructureFuel: "StructureFuel";
        StructureInactive: "StructureInactive";
        StructureOffline: "StructureOffline";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wallet: "Wallet";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    material_efficiency: z.ZodInt;
    quantity: z.ZodInt;
    runs: z.ZodInt;
    time_efficiency: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdContactsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContactsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContactsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdContactsResponse: z.ZodArray<z.ZodObject<{
    contact_id: z.ZodInt;
    contact_type: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        corporation: "corporation";
        faction: "faction";
    }>;
    is_watched: z.ZodOptional<z.ZodBoolean>;
    label_ids: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdContactsLabelsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContactsLabelsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdContactsLabelsResponse: z.ZodArray<z.ZodObject<{
    label_id: z.ZodInt;
    label_name: z.ZodString;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdContainersLogsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContainersLogsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContainersLogsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdContainersLogsResponse: z.ZodArray<z.ZodObject<{
    action: z.ZodEnum<{
        add: "add";
        assemble: "assemble";
        configure: "configure";
        enter_password: "enter_password";
        lock: "lock";
        move: "move";
        repackage: "repackage";
        set_name: "set_name";
        set_password: "set_password";
        unlock: "unlock";
    }>;
    character_id: z.ZodInt;
    container_id: z.ZodInt;
    container_type_id: z.ZodInt;
    location_flag: z.ZodEnum<{
        AssetSafety: "AssetSafety";
        AutoFit: "AutoFit";
        Bonus: "Bonus";
        Booster: "Booster";
        BoosterBay: "BoosterBay";
        Capsule: "Capsule";
        CapsuleerDeliveries: "CapsuleerDeliveries";
        Cargo: "Cargo";
        CorpDeliveries: "CorpDeliveries";
        CorpSAG1: "CorpSAG1";
        CorpSAG2: "CorpSAG2";
        CorpSAG3: "CorpSAG3";
        CorpSAG4: "CorpSAG4";
        CorpSAG5: "CorpSAG5";
        CorpSAG6: "CorpSAG6";
        CorpSAG7: "CorpSAG7";
        CorporationGoalDeliveries: "CorporationGoalDeliveries";
        CrateLoot: "CrateLoot";
        Deliveries: "Deliveries";
        DroneBay: "DroneBay";
        DustBattle: "DustBattle";
        DustDatabank: "DustDatabank";
        ExpeditionHold: "ExpeditionHold";
        FighterBay: "FighterBay";
        FighterTube0: "FighterTube0";
        FighterTube1: "FighterTube1";
        FighterTube2: "FighterTube2";
        FighterTube3: "FighterTube3";
        FighterTube4: "FighterTube4";
        FleetHangar: "FleetHangar";
        FrigateEscapeBay: "FrigateEscapeBay";
        Hangar: "Hangar";
        HangarAll: "HangarAll";
        HiSlot0: "HiSlot0";
        HiSlot1: "HiSlot1";
        HiSlot2: "HiSlot2";
        HiSlot3: "HiSlot3";
        HiSlot4: "HiSlot4";
        HiSlot5: "HiSlot5";
        HiSlot6: "HiSlot6";
        HiSlot7: "HiSlot7";
        HiddenModifiers: "HiddenModifiers";
        Implant: "Implant";
        Impounded: "Impounded";
        InfrastructureHangar: "InfrastructureHangar";
        JunkyardReprocessed: "JunkyardReprocessed";
        JunkyardTrashed: "JunkyardTrashed";
        LoSlot0: "LoSlot0";
        LoSlot1: "LoSlot1";
        LoSlot2: "LoSlot2";
        LoSlot3: "LoSlot3";
        LoSlot4: "LoSlot4";
        LoSlot5: "LoSlot5";
        LoSlot6: "LoSlot6";
        LoSlot7: "LoSlot7";
        Locked: "Locked";
        MedSlot0: "MedSlot0";
        MedSlot1: "MedSlot1";
        MedSlot2: "MedSlot2";
        MedSlot3: "MedSlot3";
        MedSlot4: "MedSlot4";
        MedSlot5: "MedSlot5";
        MedSlot6: "MedSlot6";
        MedSlot7: "MedSlot7";
        MobileDepotHold: "MobileDepotHold";
        MoonMaterialBay: "MoonMaterialBay";
        OfficeFolder: "OfficeFolder";
        Pilot: "Pilot";
        PlanetSurface: "PlanetSurface";
        QuafeBay: "QuafeBay";
        QuantumCoreRoom: "QuantumCoreRoom";
        Reward: "Reward";
        RigSlot0: "RigSlot0";
        RigSlot1: "RigSlot1";
        RigSlot2: "RigSlot2";
        RigSlot3: "RigSlot3";
        RigSlot4: "RigSlot4";
        RigSlot5: "RigSlot5";
        RigSlot6: "RigSlot6";
        RigSlot7: "RigSlot7";
        SecondaryStorage: "SecondaryStorage";
        ServiceSlot0: "ServiceSlot0";
        ServiceSlot1: "ServiceSlot1";
        ServiceSlot2: "ServiceSlot2";
        ServiceSlot3: "ServiceSlot3";
        ServiceSlot4: "ServiceSlot4";
        ServiceSlot5: "ServiceSlot5";
        ServiceSlot6: "ServiceSlot6";
        ServiceSlot7: "ServiceSlot7";
        ShipHangar: "ShipHangar";
        ShipOffline: "ShipOffline";
        Skill: "Skill";
        SkillInTraining: "SkillInTraining";
        SpecializedAmmoHold: "SpecializedAmmoHold";
        SpecializedAsteroidHold: "SpecializedAsteroidHold";
        SpecializedCommandCenterHold: "SpecializedCommandCenterHold";
        SpecializedFuelBay: "SpecializedFuelBay";
        SpecializedGasHold: "SpecializedGasHold";
        SpecializedIceHold: "SpecializedIceHold";
        SpecializedIndustrialShipHold: "SpecializedIndustrialShipHold";
        SpecializedLargeShipHold: "SpecializedLargeShipHold";
        SpecializedMaterialBay: "SpecializedMaterialBay";
        SpecializedMediumShipHold: "SpecializedMediumShipHold";
        SpecializedMineralHold: "SpecializedMineralHold";
        SpecializedOreHold: "SpecializedOreHold";
        SpecializedPlanetaryCommoditiesHold: "SpecializedPlanetaryCommoditiesHold";
        SpecializedSalvageHold: "SpecializedSalvageHold";
        SpecializedShipHold: "SpecializedShipHold";
        SpecializedSmallShipHold: "SpecializedSmallShipHold";
        StructureActive: "StructureActive";
        StructureFuel: "StructureFuel";
        StructureInactive: "StructureInactive";
        StructureOffline: "StructureOffline";
        SubSystemBay: "SubSystemBay";
        SubSystemSlot0: "SubSystemSlot0";
        SubSystemSlot1: "SubSystemSlot1";
        SubSystemSlot2: "SubSystemSlot2";
        SubSystemSlot3: "SubSystemSlot3";
        SubSystemSlot4: "SubSystemSlot4";
        SubSystemSlot5: "SubSystemSlot5";
        SubSystemSlot6: "SubSystemSlot6";
        SubSystemSlot7: "SubSystemSlot7";
        Unlocked: "Unlocked";
        Wallet: "Wallet";
        Wardrobe: "Wardrobe";
    }>;
    location_id: z.ZodInt;
    logged_at: z.ZodISODateTime;
    new_config_bitmask: z.ZodOptional<z.ZodInt>;
    old_config_bitmask: z.ZodOptional<z.ZodInt>;
    password_type: z.ZodOptional<z.ZodEnum<{
        config: "config";
        general: "general";
    }>>;
    quantity: z.ZodOptional<z.ZodInt>;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdContractsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContractsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContractsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdContractsResponse: z.ZodArray<z.ZodObject<{
    acceptor_id: z.ZodInt;
    assignee_id: z.ZodInt;
    availability: z.ZodEnum<{
        alliance: "alliance";
        corporation: "corporation";
        personal: "personal";
        public: "public";
    }>;
    buyout: z.ZodOptional<z.ZodNumber>;
    collateral: z.ZodOptional<z.ZodNumber>;
    contract_id: z.ZodInt;
    date_accepted: z.ZodOptional<z.ZodISODateTime>;
    date_completed: z.ZodOptional<z.ZodISODateTime>;
    date_expired: z.ZodISODateTime;
    date_issued: z.ZodISODateTime;
    days_to_complete: z.ZodOptional<z.ZodInt>;
    end_location_id: z.ZodOptional<z.ZodInt>;
    for_corporation: z.ZodBoolean;
    issuer_corporation_id: z.ZodInt;
    issuer_id: z.ZodInt;
    price: z.ZodOptional<z.ZodNumber>;
    reward: z.ZodOptional<z.ZodNumber>;
    start_location_id: z.ZodOptional<z.ZodInt>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        deleted: "deleted";
        failed: "failed";
        finished: "finished";
        finished_contractor: "finished_contractor";
        finished_issuer: "finished_issuer";
        in_progress: "in_progress";
        outstanding: "outstanding";
        rejected: "rejected";
        reversed: "reversed";
    }>;
    title: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        auction: "auction";
        courier: "courier";
        item_exchange: "item_exchange";
        loan: "loan";
        unknown: "unknown";
    }>;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdContractsContractIdBidsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContractsContractIdBidsPath: z.ZodObject<{
    contract_id: z.ZodInt;
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContractsContractIdBidsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdContractsContractIdBidsResponse: z.ZodArray<z.ZodObject<{
    amount: z.ZodNumber;
    bid_id: z.ZodInt;
    bidder_id: z.ZodInt;
    date_bid: z.ZodISODateTime;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdContractsContractIdItemsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdContractsContractIdItemsPath: z.ZodObject<{
    contract_id: z.ZodInt;
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdContractsContractIdItemsResponse: z.ZodArray<z.ZodObject<{
    is_included: z.ZodBoolean;
    is_singleton: z.ZodBoolean;
    quantity: z.ZodInt;
    raw_quantity: z.ZodOptional<z.ZodInt>;
    record_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdCustomsOfficesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdCustomsOfficesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdCustomsOfficesQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdCustomsOfficesResponse: z.ZodArray<z.ZodObject<{
    alliance_tax_rate: z.ZodOptional<z.ZodNumber>;
    allow_access_with_standings: z.ZodBoolean;
    allow_alliance_access: z.ZodBoolean;
    bad_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    corporation_tax_rate: z.ZodOptional<z.ZodNumber>;
    excellent_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    good_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    neutral_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    office_id: z.ZodInt;
    reinforce_exit_end: z.ZodInt;
    reinforce_exit_start: z.ZodInt;
    standing_level: z.ZodOptional<z.ZodEnum<{
        bad: "bad";
        excellent: "excellent";
        good: "good";
        neutral: "neutral";
        terrible: "terrible";
    }>>;
    system_id: z.ZodInt;
    terrible_standing_tax_rate: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdDivisionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdDivisionsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdDivisionsResponse: z.ZodObject<{
    hangar: z.ZodOptional<z.ZodArray<z.ZodObject<{
        division: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    wallet: z.ZodOptional<z.ZodArray<z.ZodObject<{
        division: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdFacilitiesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdFacilitiesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdFacilitiesResponse: z.ZodArray<z.ZodObject<{
    facility_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsFreelanceJobsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsFreelanceJobsListingPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsFreelanceJobsListingQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsFreelanceJobsListingResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    freelance_jobs: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsFreelanceJobsParticipantsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsFreelanceJobsParticipantsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    job_id: z.ZodUUID;
}, z.core.$loose>;
export declare const zGetCorporationsFreelanceJobsParticipantsQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsFreelanceJobsParticipantsResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    participants: z.ZodArray<z.ZodObject<{
        contributed: z.ZodInt;
        id: z.ZodInt;
        name: z.ZodString;
        state: z.ZodEnum<{
            Committed: "Committed";
            Kicked: "Kicked";
            Resigned: "Resigned";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdFwStatsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdFwStatsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdFwStatsResponse: z.ZodObject<{
    enlisted_on: z.ZodOptional<z.ZodISODateTime>;
    faction_id: z.ZodOptional<z.ZodInt>;
    kills: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
    pilots: z.ZodOptional<z.ZodInt>;
    victory_points: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdIconsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdIconsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdIconsResponse: z.ZodObject<{
    px128x128: z.ZodOptional<z.ZodString>;
    px256x256: z.ZodOptional<z.ZodString>;
    px64x64: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdIndustryJobsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdIndustryJobsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdIndustryJobsQuery: z.ZodObject<{
    include_completed: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdIndustryJobsResponse: z.ZodArray<z.ZodObject<{
    activity_id: z.ZodInt;
    blueprint_id: z.ZodInt;
    blueprint_location_id: z.ZodInt;
    blueprint_type_id: z.ZodInt;
    completed_character_id: z.ZodOptional<z.ZodInt>;
    completed_date: z.ZodOptional<z.ZodISODateTime>;
    cost: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodInt;
    end_date: z.ZodISODateTime;
    facility_id: z.ZodInt;
    installer_id: z.ZodInt;
    job_id: z.ZodInt;
    licensed_runs: z.ZodOptional<z.ZodInt>;
    location_id: z.ZodInt;
    output_location_id: z.ZodInt;
    pause_date: z.ZodOptional<z.ZodISODateTime>;
    probability: z.ZodOptional<z.ZodNumber>;
    product_type_id: z.ZodOptional<z.ZodInt>;
    runs: z.ZodInt;
    start_date: z.ZodISODateTime;
    status: z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        delivered: "delivered";
        paused: "paused";
        ready: "ready";
        reverted: "reverted";
    }>;
    successful_runs: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdKillmailsRecentHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdKillmailsRecentPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdKillmailsRecentQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdKillmailsRecentResponse: z.ZodArray<z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdMedalsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMedalsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMedalsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdMedalsResponse: z.ZodArray<z.ZodObject<{
    created_at: z.ZodISODateTime;
    creator_id: z.ZodInt;
    description: z.ZodString;
    medal_id: z.ZodInt;
    title: z.ZodString;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdMedalsIssuedHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMedalsIssuedPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMedalsIssuedQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdMedalsIssuedResponse: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    issued_at: z.ZodISODateTime;
    issuer_id: z.ZodInt;
    medal_id: z.ZodInt;
    reason: z.ZodString;
    status: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdMembersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMembersPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdMembersResponse: z.ZodArray<z.ZodInt>;
export declare const zGetCorporationsCorporationIdMembersLimitHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMembersLimitPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdMembersLimitResponse: z.ZodInt;
export declare const zGetCorporationsCorporationIdMembersTitlesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMembersTitlesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdMembersTitlesResponse: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    titles: z.ZodArray<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdMembertrackingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdMembertrackingPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdMembertrackingResponse: z.ZodArray<z.ZodObject<{
    base_id: z.ZodOptional<z.ZodInt>;
    character_id: z.ZodInt;
    location_id: z.ZodOptional<z.ZodInt>;
    logoff_date: z.ZodOptional<z.ZodISODateTime>;
    logon_date: z.ZodOptional<z.ZodISODateTime>;
    ship_type_id: z.ZodOptional<z.ZodInt>;
    start_date: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdOrdersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdOrdersPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdOrdersQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdOrdersResponse: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    issued: z.ZodISODateTime;
    issued_by: z.ZodInt;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
    wallet_division: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdOrdersHistoryHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdOrdersHistoryPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdOrdersHistoryQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdOrdersHistoryResponse: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    escrow: z.ZodOptional<z.ZodNumber>;
    is_buy_order: z.ZodOptional<z.ZodBoolean>;
    issued: z.ZodISODateTime;
    issued_by: z.ZodOptional<z.ZodInt>;
    location_id: z.ZodInt;
    min_volume: z.ZodOptional<z.ZodInt>;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    region_id: z.ZodInt;
    state: z.ZodEnum<{
        cancelled: "cancelled";
        expired: "expired";
    }>;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
    wallet_division: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsProjectsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsListingPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsListingQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
    state: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        Active: "Active";
        All: "All";
    }>>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsProjectsListingResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    projects: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsDetailPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    project_id: z.ZodUUID;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsProjectsDetailResponse: z.ZodObject<{
    configuration: z.ZodXor<readonly [z.ZodObject<{
        capture_fw_complex: z.ZodOptional<z.ZodObject<{
            archetypes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                archetype_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        damage_ship: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        defend_fw_complex: z.ZodOptional<z.ZodObject<{
            archetypes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                archetype_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        deliver_item: z.ZodOptional<z.ZodObject<{
            docking_locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                structure_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                station_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            items: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            office_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        destroy_npc: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        destroy_ship: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        earn_loyalty_point: z.ZodOptional<z.ZodObject<{
            corporations: z.ZodOptional<z.ZodArray<z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        lost_ship: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        manual: z.ZodOptional<z.ZodObject<{}, z.core.$catchall<z.ZodUnknown>>>;
    }, z.core.$loose>, z.ZodObject<{
        manufacture_item: z.ZodOptional<z.ZodObject<{
            docking_locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                structure_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                station_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            items: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            owner: z.ZodEnum<{
                Any: "Any";
                Character: "Character";
                Corporation: "Corporation";
            }>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        mine_material: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            materials: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        remote_boost_shield: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        remote_repair_armor: z.ZodOptional<z.ZodObject<{
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        salvage_wreck: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        scan_signature: z.ZodOptional<z.ZodObject<{
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            signatures: z.ZodOptional<z.ZodArray<z.ZodObject<{
                signature_type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        ship_insurance: z.ZodOptional<z.ZodObject<{
            conflict_type: z.ZodEnum<{
                Any: "Any";
                Pve: "Pve";
                Pvp: "Pvp";
            }>;
            identities: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                character_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                corporation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                alliance_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                faction_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            locations: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                constellation_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                region_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
            reimburse_implants: z.ZodBoolean;
            ships: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>, z.ZodObject<{
                group_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>]>>>;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodObject<{
        unknown: z.ZodOptional<z.ZodObject<{
            data: z.ZodUnknown;
            type: z.ZodString;
        }, z.core.$loose>>;
    }, z.core.$loose>]>;
    contribution: z.ZodOptional<z.ZodObject<{
        participation_limit: z.ZodOptional<z.ZodInt>;
        reward_per_contribution: z.ZodOptional<z.ZodNumber>;
        submission_limit: z.ZodOptional<z.ZodInt>;
        submission_multiplier: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
    creator: z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>;
    details: z.ZodObject<{
        career: z.ZodEnum<{
            Enforcer: "Enforcer";
            Explorer: "Explorer";
            Industrialist: "Industrialist";
            "Soldier of Fortune": "Soldier of Fortune";
            Unspecified: "Unspecified";
        }>;
        created: z.ZodISODateTime;
        description: z.ZodString;
        expires: z.ZodOptional<z.ZodISODateTime>;
        finished: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$loose>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    name: z.ZodString;
    progress: z.ZodObject<{
        current: z.ZodInt;
        desired: z.ZodInt;
    }, z.core.$loose>;
    reward: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        remaining: z.ZodNumber;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        Active: "Active";
        Closed: "Closed";
        Completed: "Completed";
        Deleted: "Deleted";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsContributionHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsContributionPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    project_id: z.ZodUUID;
    character_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsProjectsContributionResponse: z.ZodObject<{
    contributed: z.ZodInt;
    last_modified: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsContributorsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsContributorsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    project_id: z.ZodUUID;
}, z.core.$loose>;
export declare const zGetCorporationsProjectsContributorsQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsProjectsContributorsResponse: z.ZodObject<{
    contributors: z.ZodArray<z.ZodObject<{
        contributed: z.ZodInt;
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>>;
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdRolesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdRolesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdRolesResponse: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    grantable_roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdRolesHistoryHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdRolesHistoryPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdRolesHistoryQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdRolesHistoryResponse: z.ZodArray<z.ZodObject<{
    changed_at: z.ZodISODateTime;
    character_id: z.ZodInt;
    issuer_id: z.ZodInt;
    new_roles: z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>;
    old_roles: z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>;
    role_type: z.ZodEnum<{
        grantable_roles: "grantable_roles";
        grantable_roles_at_base: "grantable_roles_at_base";
        grantable_roles_at_hq: "grantable_roles_at_hq";
        grantable_roles_at_other: "grantable_roles_at_other";
        roles: "roles";
        roles_at_base: "roles_at_base";
        roles_at_hq: "roles_at_hq";
        roles_at_other: "roles_at_other";
    }>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdShareholdersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdShareholdersPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdShareholdersQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdShareholdersResponse: z.ZodArray<z.ZodObject<{
    share_count: z.ZodInt;
    shareholder_id: z.ZodInt;
    shareholder_type: z.ZodEnum<{
        character: "character";
        corporation: "corporation";
    }>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdStandingsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStandingsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStandingsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdStandingsResponse: z.ZodArray<z.ZodObject<{
    from_id: z.ZodInt;
    from_type: z.ZodEnum<{
        agent: "agent";
        faction: "faction";
        npc_corp: "npc_corp";
    }>;
    standing: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdStarbasesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStarbasesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStarbasesQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdStarbasesResponse: z.ZodArray<z.ZodObject<{
    moon_id: z.ZodOptional<z.ZodInt>;
    onlined_since: z.ZodOptional<z.ZodISODateTime>;
    reinforced_until: z.ZodOptional<z.ZodISODateTime>;
    starbase_id: z.ZodInt;
    state: z.ZodOptional<z.ZodEnum<{
        offline: "offline";
        online: "online";
        onlining: "onlining";
        reinforced: "reinforced";
        unanchoring: "unanchoring";
    }>>;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
    unanchor_at: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdStarbasesStarbaseIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStarbasesStarbaseIdPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    starbase_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStarbasesStarbaseIdQuery: z.ZodObject<{
    system_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdStarbasesStarbaseIdResponse: z.ZodObject<{
    allow_alliance_members: z.ZodBoolean;
    allow_corporation_members: z.ZodBoolean;
    anchor: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    attack_if_at_war: z.ZodBoolean;
    attack_if_other_security_status_dropping: z.ZodBoolean;
    attack_security_status_threshold: z.ZodOptional<z.ZodNumber>;
    attack_standing_threshold: z.ZodOptional<z.ZodNumber>;
    fuel_bay_take: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    fuel_bay_view: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    fuels: z.ZodOptional<z.ZodArray<z.ZodObject<{
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>>;
    offline: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    online: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    unanchor: z.ZodEnum<{
        alliance_member: "alliance_member";
        config_starbase_equipment_role: "config_starbase_equipment_role";
        corporation_member: "corporation_member";
        starbase_fuel_technician_role: "starbase_fuel_technician_role";
    }>;
    use_alliance_standings: z.ZodBoolean;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStructuresHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStructuresPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdStructuresQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdStructuresResponse: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodInt;
    fuel_expires: z.ZodOptional<z.ZodISODateTime>;
    name: z.ZodOptional<z.ZodString>;
    next_reinforce_apply: z.ZodOptional<z.ZodISODateTime>;
    next_reinforce_hour: z.ZodOptional<z.ZodInt>;
    profile_id: z.ZodInt;
    reinforce_hour: z.ZodOptional<z.ZodInt>;
    services: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        state: z.ZodEnum<{
            cleanup: "cleanup";
            offline: "offline";
            online: "online";
        }>;
    }, z.core.$loose>>>;
    state: z.ZodEnum<{
        anchor_vulnerable: "anchor_vulnerable";
        anchoring: "anchoring";
        armor_reinforce: "armor_reinforce";
        armor_vulnerable: "armor_vulnerable";
        deploy_vulnerable: "deploy_vulnerable";
        fitting_invulnerable: "fitting_invulnerable";
        hull_reinforce: "hull_reinforce";
        hull_vulnerable: "hull_vulnerable";
        online_deprecated: "online_deprecated";
        onlining_vulnerable: "onlining_vulnerable";
        shield_vulnerable: "shield_vulnerable";
        unanchored: "unanchored";
        unknown: "unknown";
    }>;
    state_timer_end: z.ZodOptional<z.ZodISODateTime>;
    state_timer_start: z.ZodOptional<z.ZodISODateTime>;
    structure_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
    unanchors_at: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>>;
export declare const zGetCorporationsStructuresSkyhooksListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSkyhooksListingPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsStructuresSkyhooksListingResponse: z.ZodObject<{
    skyhooks: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        planet_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSkyhooksDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSkyhooksDetailPath: z.ZodObject<{
    skyhook_id: z.ZodInt;
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsStructuresSkyhooksDetailResponse: z.ZodObject<{
    effective_workforce: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    is_active: z.ZodBoolean;
    planet_id: z.ZodInt;
    reagents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        last_cycle: z.ZodISODateTime;
        secured_stock: z.ZodInt;
        type_id: z.ZodInt;
        unsecured_stock: z.ZodInt;
    }, z.core.$loose>>>;
    reinforcement_timer: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        ArmorReinforced: "ArmorReinforced";
        ArmorVulnerable: "ArmorVulnerable";
        HullReinforced: "HullReinforced";
        HullVulnerable: "HullVulnerable";
        ShieldVulnerable: "ShieldVulnerable";
        Unspecified: "Unspecified";
    }>;
    theft_vulnerability: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
        start: z.ZodISODateTime;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSovereigntyHubsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSovereigntyHubsListingPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsStructuresSovereigntyHubsListingResponse: z.ZodObject<{
    sovereignty_hubs: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        solar_system_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSovereigntyHubsDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsStructuresSovereigntyHubsDetailPath: z.ZodObject<{
    sovereignty_hub_id: z.ZodInt;
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsStructuresSovereigntyHubsDetailResponse: z.ZodObject<{
    fuel_access_list_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    reagent_bay: z.ZodObject<{
        last_updated: z.ZodISODateTime;
        reagents: z.ZodArray<z.ZodObject<{
            amount: z.ZodInt;
            burning_per_hour: z.ZodInt;
            type_id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    resources: z.ZodObject<{
        power: z.ZodObject<{
            allocated: z.ZodInt;
            available: z.ZodInt;
        }, z.core.$loose>;
        workforce: z.ZodObject<{
            allocated: z.ZodInt;
            available: z.ZodInt;
        }, z.core.$loose>;
    }, z.core.$loose>;
    solar_system_id: z.ZodInt;
    upgrades: z.ZodArray<z.ZodObject<{
        power_state: z.ZodEnum<{
            Low: "Low";
            Offline: "Offline";
            Online: "Online";
            Pending: "Pending";
            Unspecified: "Unspecified";
        }>;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    vulnerability_window: z.ZodOptional<z.ZodObject<{
        end: z.ZodISODateTime;
        start: z.ZodISODateTime;
    }, z.core.$loose>>;
    workforce_transport: z.ZodObject<{
        configuration: z.ZodXor<readonly [z.ZodObject<{
            import: z.ZodOptional<z.ZodObject<{
                sources: z.ZodArray<z.ZodObject<{
                    solar_system_id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            export: z.ZodOptional<z.ZodObject<{
                amount: z.ZodInt;
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            transit: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        }, z.core.$loose>]>;
        state: z.ZodXor<readonly [z.ZodObject<{
            import: z.ZodOptional<z.ZodObject<{
                sources: z.ZodArray<z.ZodObject<{
                    amount: z.ZodInt;
                    solar_system_id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            export: z.ZodOptional<z.ZodObject<{
                amount: z.ZodOptional<z.ZodInt>;
                solar_system_id: z.ZodOptional<z.ZodInt>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            transit: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        }, z.core.$loose>]>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdTitlesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdTitlesPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdTitlesResponse: z.ZodArray<z.ZodObject<{
    grantable_roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    grantable_roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    name: z.ZodOptional<z.ZodString>;
    roles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_base: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_hq: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    roles_at_other: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        Account_Take_1: "Account_Take_1";
        Account_Take_2: "Account_Take_2";
        Account_Take_3: "Account_Take_3";
        Account_Take_4: "Account_Take_4";
        Account_Take_5: "Account_Take_5";
        Account_Take_6: "Account_Take_6";
        Account_Take_7: "Account_Take_7";
        Accountant: "Accountant";
        Auditor: "Auditor";
        Brand_Manager: "Brand_Manager";
        Communications_Officer: "Communications_Officer";
        Config_Equipment: "Config_Equipment";
        Config_Starbase_Equipment: "Config_Starbase_Equipment";
        Container_Take_1: "Container_Take_1";
        Container_Take_2: "Container_Take_2";
        Container_Take_3: "Container_Take_3";
        Container_Take_4: "Container_Take_4";
        Container_Take_5: "Container_Take_5";
        Container_Take_6: "Container_Take_6";
        Container_Take_7: "Container_Take_7";
        Contract_Manager: "Contract_Manager";
        Deliveries_Container_Take: "Deliveries_Container_Take";
        Deliveries_Query: "Deliveries_Query";
        Deliveries_Take: "Deliveries_Take";
        Diplomat: "Diplomat";
        Director: "Director";
        Factory_Manager: "Factory_Manager";
        Fitting_Manager: "Fitting_Manager";
        Hangar_Query_1: "Hangar_Query_1";
        Hangar_Query_2: "Hangar_Query_2";
        Hangar_Query_3: "Hangar_Query_3";
        Hangar_Query_4: "Hangar_Query_4";
        Hangar_Query_5: "Hangar_Query_5";
        Hangar_Query_6: "Hangar_Query_6";
        Hangar_Query_7: "Hangar_Query_7";
        Hangar_Take_1: "Hangar_Take_1";
        Hangar_Take_2: "Hangar_Take_2";
        Hangar_Take_3: "Hangar_Take_3";
        Hangar_Take_4: "Hangar_Take_4";
        Hangar_Take_5: "Hangar_Take_5";
        Hangar_Take_6: "Hangar_Take_6";
        Hangar_Take_7: "Hangar_Take_7";
        Junior_Accountant: "Junior_Accountant";
        Personnel_Manager: "Personnel_Manager";
        Project_Manager: "Project_Manager";
        Rent_Factory_Facility: "Rent_Factory_Facility";
        Rent_Office: "Rent_Office";
        Rent_Research_Facility: "Rent_Research_Facility";
        Security_Officer: "Security_Officer";
        Skill_Plan_Manager: "Skill_Plan_Manager";
        Starbase_Defense_Operator: "Starbase_Defense_Operator";
        Starbase_Fuel_Technician: "Starbase_Fuel_Technician";
        Station_Manager: "Station_Manager";
        Trader: "Trader";
    }>>>;
    title_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdWalletsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdWalletsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdWalletsResponse: z.ZodArray<z.ZodObject<{
    balance: z.ZodNumber;
    division: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdWalletsDivisionJournalHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdWalletsDivisionJournalPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    division: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdWalletsDivisionJournalQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdWalletsDivisionJournalResponse: z.ZodArray<z.ZodObject<{
    amount: z.ZodOptional<z.ZodNumber>;
    balance: z.ZodOptional<z.ZodNumber>;
    context_id: z.ZodOptional<z.ZodInt>;
    context_id_type: z.ZodOptional<z.ZodEnum<{
        alliance_id: "alliance_id";
        character_id: "character_id";
        contract_id: "contract_id";
        corporation_id: "corporation_id";
        eve_system: "eve_system";
        industry_job_id: "industry_job_id";
        market_transaction_id: "market_transaction_id";
        planet_id: "planet_id";
        station_id: "station_id";
        structure_id: "structure_id";
        system_id: "system_id";
        type_id: "type_id";
    }>>;
    date: z.ZodISODateTime;
    description: z.ZodString;
    first_party_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    reason: z.ZodOptional<z.ZodString>;
    ref_type: z.ZodEnum<{
        acceleration_gate_fee: "acceleration_gate_fee";
        achievement_category_milestone_reward: "achievement_category_milestone_reward";
        achievement_milestone_reward: "achievement_milestone_reward";
        advertisement_listing_fee: "advertisement_listing_fee";
        agent_donation: "agent_donation";
        agent_location_services: "agent_location_services";
        agent_miscellaneous: "agent_miscellaneous";
        agent_mission_collateral_paid: "agent_mission_collateral_paid";
        agent_mission_collateral_refunded: "agent_mission_collateral_refunded";
        agent_mission_reward: "agent_mission_reward";
        agent_mission_reward_corporation_tax: "agent_mission_reward_corporation_tax";
        agent_mission_security_tax: "agent_mission_security_tax";
        agent_mission_time_bonus_reward: "agent_mission_time_bonus_reward";
        agent_mission_time_bonus_reward_corporation_tax: "agent_mission_time_bonus_reward_corporation_tax";
        agent_security_services: "agent_security_services";
        agent_services_rendered: "agent_services_rendered";
        agents_preward: "agents_preward";
        air_career_program_reward: "air_career_program_reward";
        alliance_maintainance_fee: "alliance_maintainance_fee";
        alliance_registration_fee: "alliance_registration_fee";
        allignment_based_gate_toll: "allignment_based_gate_toll";
        asset_safety_recovery_tax: "asset_safety_recovery_tax";
        bounty: "bounty";
        bounty_prize: "bounty_prize";
        bounty_prize_corporation_tax: "bounty_prize_corporation_tax";
        bounty_prizes: "bounty_prizes";
        bounty_reimbursement: "bounty_reimbursement";
        bounty_surcharge: "bounty_surcharge";
        brokers_fee: "brokers_fee";
        campaign_objective_isk_reward: "campaign_objective_isk_reward";
        clone_activation: "clone_activation";
        clone_transfer: "clone_transfer";
        contraband_fine: "contraband_fine";
        contract_auction_bid: "contract_auction_bid";
        contract_auction_bid_corp: "contract_auction_bid_corp";
        contract_auction_bid_refund: "contract_auction_bid_refund";
        contract_auction_sold: "contract_auction_sold";
        contract_brokers_fee: "contract_brokers_fee";
        contract_brokers_fee_corp: "contract_brokers_fee_corp";
        contract_collateral: "contract_collateral";
        contract_collateral_deposited_corp: "contract_collateral_deposited_corp";
        contract_collateral_payout: "contract_collateral_payout";
        contract_collateral_refund: "contract_collateral_refund";
        contract_deposit: "contract_deposit";
        contract_deposit_corp: "contract_deposit_corp";
        contract_deposit_refund: "contract_deposit_refund";
        contract_deposit_sales_tax: "contract_deposit_sales_tax";
        contract_price: "contract_price";
        contract_price_payment_corp: "contract_price_payment_corp";
        contract_reversal: "contract_reversal";
        contract_reward: "contract_reward";
        contract_reward_deposited: "contract_reward_deposited";
        contract_reward_deposited_corp: "contract_reward_deposited_corp";
        contract_reward_refund: "contract_reward_refund";
        contract_sales_tax: "contract_sales_tax";
        copying: "copying";
        corporate_reward_payout: "corporate_reward_payout";
        corporate_reward_tax: "corporate_reward_tax";
        corporation_account_withdrawal: "corporation_account_withdrawal";
        corporation_bulk_payment: "corporation_bulk_payment";
        corporation_dividend_payment: "corporation_dividend_payment";
        corporation_liquidation: "corporation_liquidation";
        corporation_logo_change_cost: "corporation_logo_change_cost";
        corporation_payment: "corporation_payment";
        corporation_registration_fee: "corporation_registration_fee";
        cosmetic_market_component_item_purchase: "cosmetic_market_component_item_purchase";
        cosmetic_market_skin_purchase: "cosmetic_market_skin_purchase";
        cosmetic_market_skin_sale: "cosmetic_market_skin_sale";
        cosmetic_market_skin_sale_broker_fee: "cosmetic_market_skin_sale_broker_fee";
        cosmetic_market_skin_sale_tax: "cosmetic_market_skin_sale_tax";
        cosmetic_market_skin_transaction: "cosmetic_market_skin_transaction";
        courier_mission_escrow: "courier_mission_escrow";
        cspa: "cspa";
        cspaofflinerefund: "cspaofflinerefund";
        daily_challenge_reward: "daily_challenge_reward";
        daily_goal_payouts: "daily_goal_payouts";
        daily_goal_payouts_tax: "daily_goal_payouts_tax";
        datacore_fee: "datacore_fee";
        dna_modification_fee: "dna_modification_fee";
        docking_fee: "docking_fee";
        duel_wager_escrow: "duel_wager_escrow";
        duel_wager_payment: "duel_wager_payment";
        duel_wager_refund: "duel_wager_refund";
        ess_escrow_transfer: "ess_escrow_transfer";
        external_trade_delivery: "external_trade_delivery";
        external_trade_freeze: "external_trade_freeze";
        external_trade_thaw: "external_trade_thaw";
        factory_slot_rental_fee: "factory_slot_rental_fee";
        flux_payout: "flux_payout";
        flux_tax: "flux_tax";
        flux_ticket_repayment: "flux_ticket_repayment";
        flux_ticket_sale: "flux_ticket_sale";
        freelance_jobs_broadcasting_fee: "freelance_jobs_broadcasting_fee";
        freelance_jobs_duration_fee: "freelance_jobs_duration_fee";
        freelance_jobs_escrow_refund: "freelance_jobs_escrow_refund";
        freelance_jobs_reward: "freelance_jobs_reward";
        freelance_jobs_reward_corporation_tax: "freelance_jobs_reward_corporation_tax";
        freelance_jobs_reward_escrow: "freelance_jobs_reward_escrow";
        gm_cash_transfer: "gm_cash_transfer";
        gm_plex_fee_refund: "gm_plex_fee_refund";
        industry_job_tax: "industry_job_tax";
        industry_security_tax: "industry_security_tax";
        infrastructure_hub_maintenance: "infrastructure_hub_maintenance";
        inheritance: "inheritance";
        insurance: "insurance";
        insurgency_corruption_contribution_reward: "insurgency_corruption_contribution_reward";
        insurgency_suppression_contribution_reward: "insurgency_suppression_contribution_reward";
        item_trader_payment: "item_trader_payment";
        jump_clone_activation_fee: "jump_clone_activation_fee";
        jump_clone_installation_fee: "jump_clone_installation_fee";
        kill_right_fee: "kill_right_fee";
        lp_store: "lp_store";
        manufacturing: "manufacturing";
        market_escrow: "market_escrow";
        market_fine_paid: "market_fine_paid";
        market_provider_tax: "market_provider_tax";
        market_security_tax: "market_security_tax";
        market_transaction: "market_transaction";
        medal_creation: "medal_creation";
        medal_issued: "medal_issued";
        milestone_reward_payment: "milestone_reward_payment";
        mission_completion: "mission_completion";
        mission_cost: "mission_cost";
        mission_expiration: "mission_expiration";
        mission_reward: "mission_reward";
        npc_bounty_security_tax: "npc_bounty_security_tax";
        office_rental_fee: "office_rental_fee";
        operation_bonus: "operation_bonus";
        opportunity_reward: "opportunity_reward";
        planetary_construction: "planetary_construction";
        planetary_export_tax: "planetary_export_tax";
        planetary_import_tax: "planetary_import_tax";
        player_donation: "player_donation";
        player_trading: "player_trading";
        project_discovery_reward: "project_discovery_reward";
        project_discovery_tax: "project_discovery_tax";
        project_payouts: "project_payouts";
        reaction: "reaction";
        redeemed_isk_token: "redeemed_isk_token";
        release_of_impounded_property: "release_of_impounded_property";
        repair_bill: "repair_bill";
        reprocessing_tax: "reprocessing_tax";
        researching_material_productivity: "researching_material_productivity";
        researching_technology: "researching_technology";
        researching_time_productivity: "researching_time_productivity";
        resource_wars_reward: "resource_wars_reward";
        reverse_engineering: "reverse_engineering";
        season_challenge_reward: "season_challenge_reward";
        security_processing_fee: "security_processing_fee";
        shares: "shares";
        skill_purchase: "skill_purchase";
        skyhook_claim_fee: "skyhook_claim_fee";
        sovereignity_bill: "sovereignity_bill";
        store_purchase: "store_purchase";
        store_purchase_refund: "store_purchase_refund";
        structure_gate_jump: "structure_gate_jump";
        transaction_tax: "transaction_tax";
        under_construction: "under_construction";
        upkeep_adjustment_fee: "upkeep_adjustment_fee";
        war_ally_contract: "war_ally_contract";
        war_fee: "war_fee";
        war_fee_surrender: "war_fee_surrender";
    }>;
    second_party_id: z.ZodOptional<z.ZodInt>;
    tax: z.ZodOptional<z.ZodNumber>;
    tax_receiver_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>>;
export declare const zGetCorporationsCorporationIdWalletsDivisionTransactionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdWalletsDivisionTransactionsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
    division: z.ZodInt;
}, z.core.$loose>;
export declare const zGetCorporationsCorporationIdWalletsDivisionTransactionsQuery: z.ZodObject<{
    from_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCorporationsCorporationIdWalletsDivisionTransactionsResponse: z.ZodArray<z.ZodObject<{
    client_id: z.ZodInt;
    date: z.ZodISODateTime;
    is_buy: z.ZodBoolean;
    journal_ref_id: z.ZodInt;
    location_id: z.ZodInt;
    quantity: z.ZodInt;
    transaction_id: z.ZodInt;
    type_id: z.ZodInt;
    unit_price: z.ZodNumber;
}, z.core.$loose>>;
export declare const zGetCosmeticsSkinrHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetCosmeticsSkinrPath: z.ZodObject<{
    skinr_id: z.ZodString;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetCosmeticsSkinrResponse: z.ZodObject<{
    creator_id: z.ZodInt;
    id: z.ZodString;
    layout: z.ZodObject<{
        pattern_blend_mode: z.ZodEnum<{
            exclusion: "exclusion";
            nested: "nested";
            nested_inverted: "nested_inverted";
            normal: "normal";
            subtract: "subtract";
        }>;
        slots: z.ZodArray<z.ZodObject<{
            configuration: z.ZodXor<readonly [z.ZodObject<{
                nanocoating: z.ZodOptional<z.ZodObject<{
                    id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>, z.ZodObject<{
                pattern: z.ZodOptional<z.ZodObject<{
                    configuration: z.ZodObject<{
                        mirrored: z.ZodBoolean;
                        projection: z.ZodObject<{
                            slot1: z.ZodBoolean;
                            slot2: z.ZodBoolean;
                            slot3: z.ZodBoolean;
                            slot4: z.ZodBoolean;
                        }, z.core.$loose>;
                        transform: z.ZodObject<{
                            position: z.ZodObject<{
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                z: z.ZodNumber;
                            }, z.core.$loose>;
                            rotation: z.ZodObject<{
                                w: z.ZodNumber;
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                z: z.ZodNumber;
                            }, z.core.$loose>;
                            scaling: z.ZodObject<{
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                z: z.ZodNumber;
                            }, z.core.$loose>;
                        }, z.core.$loose>;
                    }, z.core.$loose>;
                    id: z.ZodInt;
                }, z.core.$loose>>;
            }, z.core.$loose>]>;
            id: z.ZodInt;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    line: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    ship_type_id: z.ZodInt;
    tier: z.ZodObject<{
        level: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetDogmaAttributesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetDogmaAttributesResponse: z.ZodArray<z.ZodInt>;
export declare const zGetDogmaAttributesAttributeIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetDogmaAttributesAttributeIdPath: z.ZodObject<{
    attribute_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetDogmaAttributesAttributeIdResponse: z.ZodObject<{
    attribute_id: z.ZodInt;
    default_value: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    display_name: z.ZodOptional<z.ZodString>;
    high_is_good: z.ZodOptional<z.ZodBoolean>;
    icon_id: z.ZodOptional<z.ZodInt>;
    name: z.ZodOptional<z.ZodString>;
    published: z.ZodOptional<z.ZodBoolean>;
    stackable: z.ZodOptional<z.ZodBoolean>;
    unit_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetDogmaDynamicItemsTypeIdItemIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetDogmaDynamicItemsTypeIdItemIdPath: z.ZodObject<{
    item_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetDogmaDynamicItemsTypeIdItemIdResponse: z.ZodObject<{
    created_by: z.ZodInt;
    dogma_attributes: z.ZodArray<z.ZodObject<{
        attribute_id: z.ZodInt;
        value: z.ZodNumber;
    }, z.core.$loose>>;
    dogma_effects: z.ZodArray<z.ZodObject<{
        effect_id: z.ZodInt;
        is_default: z.ZodBoolean;
    }, z.core.$loose>>;
    mutator_type_id: z.ZodInt;
    source_type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetDogmaEffectsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetDogmaEffectsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetDogmaEffectsEffectIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetDogmaEffectsEffectIdPath: z.ZodObject<{
    effect_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetDogmaEffectsEffectIdResponse: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    disallow_auto_repeat: z.ZodOptional<z.ZodBoolean>;
    discharge_attribute_id: z.ZodOptional<z.ZodInt>;
    display_name: z.ZodOptional<z.ZodString>;
    duration_attribute_id: z.ZodOptional<z.ZodInt>;
    effect_category: z.ZodOptional<z.ZodInt>;
    effect_id: z.ZodInt;
    electronic_chance: z.ZodOptional<z.ZodBoolean>;
    falloff_attribute_id: z.ZodOptional<z.ZodInt>;
    icon_id: z.ZodOptional<z.ZodInt>;
    is_assistance: z.ZodOptional<z.ZodBoolean>;
    is_offensive: z.ZodOptional<z.ZodBoolean>;
    is_warp_safe: z.ZodOptional<z.ZodBoolean>;
    modifiers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        domain: z.ZodOptional<z.ZodString>;
        effect_id: z.ZodOptional<z.ZodInt>;
        func: z.ZodString;
        modified_attribute_id: z.ZodOptional<z.ZodInt>;
        modifying_attribute_id: z.ZodOptional<z.ZodInt>;
        operator: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    name: z.ZodOptional<z.ZodString>;
    post_expression: z.ZodOptional<z.ZodInt>;
    pre_expression: z.ZodOptional<z.ZodInt>;
    published: z.ZodOptional<z.ZodBoolean>;
    range_attribute_id: z.ZodOptional<z.ZodInt>;
    range_chance: z.ZodOptional<z.ZodBoolean>;
    tracking_speed_attribute_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetFleetsFleetIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetFleetsFleetIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFleetsFleetIdResponse: z.ZodObject<{
    is_free_move: z.ZodBoolean;
    is_registered: z.ZodBoolean;
    is_voice_enabled: z.ZodBoolean;
    motd: z.ZodString;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdBody: z.ZodObject<{
    is_free_move: z.ZodOptional<z.ZodBoolean>;
    motd: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Fleet updated
 */
export declare const zPutFleetsFleetIdResponse: z.ZodUndefined;
export declare const zGetFleetsFleetIdMembersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetFleetsFleetIdMembersPath: z.ZodObject<{
    fleet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFleetsFleetIdMembersResponse: z.ZodArray<z.ZodObject<{
    character_id: z.ZodInt;
    join_time: z.ZodISODateTime;
    role: z.ZodEnum<{
        fleet_commander: "fleet_commander";
        squad_commander: "squad_commander";
        squad_member: "squad_member";
        wing_commander: "wing_commander";
    }>;
    role_name: z.ZodString;
    ship_type_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    squad_id: z.ZodInt;
    station_id: z.ZodOptional<z.ZodInt>;
    takes_fleet_warp: z.ZodBoolean;
    wing_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zPostFleetsFleetIdMembersBody: z.ZodObject<{
    character_id: z.ZodInt;
    role: z.ZodEnum<{
        fleet_commander: "fleet_commander";
        squad_commander: "squad_commander";
        squad_member: "squad_member";
        wing_commander: "wing_commander";
    }>;
    squad_id: z.ZodOptional<z.ZodInt>;
    wing_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zPostFleetsFleetIdMembersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostFleetsFleetIdMembersPath: z.ZodObject<{
    fleet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Fleet invitation sent
 */
export declare const zPostFleetsFleetIdMembersResponse: z.ZodUndefined;
export declare const zDeleteFleetsFleetIdMembersMemberIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteFleetsFleetIdMembersMemberIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    member_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Fleet member kicked
 */
export declare const zDeleteFleetsFleetIdMembersMemberIdResponse: z.ZodUndefined;
export declare const zPutFleetsFleetIdMembersMemberIdBody: z.ZodObject<{
    role: z.ZodEnum<{
        fleet_commander: "fleet_commander";
        squad_commander: "squad_commander";
        squad_member: "squad_member";
        wing_commander: "wing_commander";
    }>;
    squad_id: z.ZodOptional<z.ZodInt>;
    wing_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdMembersMemberIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdMembersMemberIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    member_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Fleet invitation sent
 */
export declare const zPutFleetsFleetIdMembersMemberIdResponse: z.ZodUndefined;
export declare const zDeleteFleetsFleetIdSquadsSquadIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteFleetsFleetIdSquadsSquadIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    squad_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Squad deleted
 */
export declare const zDeleteFleetsFleetIdSquadsSquadIdResponse: z.ZodUndefined;
export declare const zPutFleetsFleetIdSquadsSquadIdBody: z.ZodObject<{
    name: z.ZodString;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdSquadsSquadIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdSquadsSquadIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    squad_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Squad renamed
 */
export declare const zPutFleetsFleetIdSquadsSquadIdResponse: z.ZodUndefined;
export declare const zGetFleetsFleetIdWingsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetFleetsFleetIdWingsPath: z.ZodObject<{
    fleet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFleetsFleetIdWingsResponse: z.ZodArray<z.ZodObject<{
    id: z.ZodInt;
    name: z.ZodString;
    squads: z.ZodArray<z.ZodObject<{
        id: z.ZodInt;
        name: z.ZodString;
    }, z.core.$loose>>;
}, z.core.$loose>>;
export declare const zPostFleetsFleetIdWingsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostFleetsFleetIdWingsPath: z.ZodObject<{
    fleet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostFleetsFleetIdWingsResponse: z.ZodObject<{
    wing_id: z.ZodInt;
}, z.core.$loose>;
export declare const zDeleteFleetsFleetIdWingsWingIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zDeleteFleetsFleetIdWingsWingIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    wing_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Wing deleted
 */
export declare const zDeleteFleetsFleetIdWingsWingIdResponse: z.ZodUndefined;
export declare const zPutFleetsFleetIdWingsWingIdBody: z.ZodObject<{
    name: z.ZodString;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdWingsWingIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPutFleetsFleetIdWingsWingIdPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    wing_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Wing renamed
 */
export declare const zPutFleetsFleetIdWingsWingIdResponse: z.ZodUndefined;
export declare const zPostFleetsFleetIdWingsWingIdSquadsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostFleetsFleetIdWingsWingIdSquadsPath: z.ZodObject<{
    fleet_id: z.ZodInt;
    wing_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Created
 */
export declare const zPostFleetsFleetIdWingsWingIdSquadsResponse: z.ZodObject<{
    squad_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetFreelanceJobsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetFreelanceJobsListingQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
    corporation_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFreelanceJobsListingResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    freelance_jobs: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        name: z.ZodString;
        progress: z.ZodObject<{
            current: z.ZodInt;
            desired: z.ZodInt;
        }, z.core.$loose>;
        reward: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            remaining: z.ZodNumber;
        }, z.core.$loose>>;
        state: z.ZodEnum<{
            Active: "Active";
            Closed: "Closed";
            Completed: "Completed";
            Deleted: "Deleted";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetFreelanceJobsDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetFreelanceJobsDetailPath: z.ZodObject<{
    job_id: z.ZodUUID;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFreelanceJobsDetailResponse: z.ZodObject<{
    access_and_visibility: z.ZodObject<{
        acl_protected: z.ZodBoolean;
        broadcast_locations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodInt;
            name: z.ZodString;
        }, z.core.$loose>>>;
        restrictions: z.ZodOptional<z.ZodObject<{
            maximum_age: z.ZodOptional<z.ZodInt>;
            minimum_age: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    configuration: z.ZodObject<{
        method: z.ZodString;
        parameters: z.ZodObject<{}, z.core.$catchall<z.ZodXor<readonly [z.ZodObject<{
            matcher: z.ZodOptional<z.ZodObject<{
                values: z.ZodArray<z.ZodObject<{
                    value_type: z.ZodString;
                    values: z.ZodArray<z.ZodString>;
                }, z.core.$loose>>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            options: z.ZodOptional<z.ZodObject<{
                selected: z.ZodArray<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            boolean: z.ZodOptional<z.ZodObject<{
                value: z.ZodBoolean;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            corporation_item_delivery: z.ZodOptional<z.ZodObject<{
                corporation_office_location: z.ZodObject<{
                    values: z.ZodArray<z.ZodObject<{
                        value_type: z.ZodString;
                        values: z.ZodArray<z.ZodString>;
                    }, z.core.$loose>>;
                }, z.core.$loose>;
                item_type: z.ZodObject<{
                    values: z.ZodArray<z.ZodObject<{
                        value_type: z.ZodString;
                        values: z.ZodArray<z.ZodString>;
                    }, z.core.$loose>>;
                }, z.core.$loose>;
            }, z.core.$loose>>;
        }, z.core.$loose>]>>>;
        version: z.ZodInt;
    }, z.core.$loose>;
    contribution: z.ZodOptional<z.ZodObject<{
        contribution_per_participant_limit: z.ZodOptional<z.ZodInt>;
        max_committed_participants: z.ZodInt;
        reward_per_contribution: z.ZodOptional<z.ZodNumber>;
        submission_limit: z.ZodOptional<z.ZodInt>;
        submission_multiplier: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
    details: z.ZodObject<{
        career: z.ZodEnum<{
            Enforcer: "Enforcer";
            Explorer: "Explorer";
            Industrialist: "Industrialist";
            "Soldier of Fortune": "Soldier of Fortune";
            Unspecified: "Unspecified";
        }>;
        created: z.ZodISODateTime;
        creator: z.ZodObject<{
            character: z.ZodObject<{
                id: z.ZodInt;
                name: z.ZodString;
            }, z.core.$loose>;
            corporation: z.ZodObject<{
                id: z.ZodInt;
                name: z.ZodString;
            }, z.core.$loose>;
        }, z.core.$loose>;
        description: z.ZodString;
        expires: z.ZodOptional<z.ZodISODateTime>;
        finished: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$loose>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    name: z.ZodString;
    progress: z.ZodObject<{
        current: z.ZodInt;
        desired: z.ZodInt;
    }, z.core.$loose>;
    reward: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        remaining: z.ZodNumber;
    }, z.core.$loose>>;
    state: z.ZodEnum<{
        Active: "Active";
        Closed: "Closed";
        Completed: "Completed";
        Deleted: "Deleted";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zGetFwLeaderboardsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFwLeaderboardsResponse: z.ZodObject<{
    kills: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            faction_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetFwLeaderboardsCharactersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFwLeaderboardsCharactersResponse: z.ZodObject<{
    kills: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            character_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetFwLeaderboardsCorporationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFwLeaderboardsCorporationsResponse: z.ZodObject<{
    kills: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    victory_points: z.ZodObject<{
        active_total: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        last_week: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
        yesterday: z.ZodArray<z.ZodObject<{
            amount: z.ZodOptional<z.ZodInt>;
            corporation_id: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const zGetFwStatsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFwStatsResponse: z.ZodArray<z.ZodObject<{
    faction_id: z.ZodInt;
    kills: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
    pilots: z.ZodInt;
    systems_controlled: z.ZodInt;
    victory_points: z.ZodObject<{
        last_week: z.ZodInt;
        total: z.ZodInt;
        yesterday: z.ZodInt;
    }, z.core.$loose>;
}, z.core.$loose>>;
export declare const zGetFwSystemsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFwSystemsResponse: z.ZodArray<z.ZodObject<{
    contested: z.ZodEnum<{
        captured: "captured";
        contested: "contested";
        uncontested: "uncontested";
        vulnerable: "vulnerable";
    }>;
    occupier_faction_id: z.ZodInt;
    owner_faction_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    victory_points: z.ZodInt;
    victory_points_threshold: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetFwWarsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetFwWarsResponse: z.ZodArray<z.ZodObject<{
    against_id: z.ZodInt;
    faction_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetIncursionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetIncursionsResponse: z.ZodArray<z.ZodObject<{
    constellation_id: z.ZodInt;
    faction_id: z.ZodInt;
    has_boss: z.ZodBoolean;
    infested_solar_systems: z.ZodArray<z.ZodInt>;
    influence: z.ZodNumber;
    staging_solar_system_id: z.ZodInt;
    state: z.ZodEnum<{
        established: "established";
        mobilizing: "mobilizing";
        withdrawing: "withdrawing";
    }>;
    type: z.ZodString;
}, z.core.$loose>>;
export declare const zGetIndustryFacilitiesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetIndustryFacilitiesResponse: z.ZodArray<z.ZodObject<{
    facility_id: z.ZodInt;
    owner_id: z.ZodInt;
    region_id: z.ZodInt;
    solar_system_id: z.ZodInt;
    tax: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetIndustrySystemsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetIndustrySystemsResponse: z.ZodArray<z.ZodObject<{
    cost_indices: z.ZodArray<z.ZodObject<{
        activity: z.ZodEnum<{
            copying: "copying";
            duplicating: "duplicating";
            invention: "invention";
            manufacturing: "manufacturing";
            none: "none";
            reaction: "reaction";
            researching_material_efficiency: "researching_material_efficiency";
            researching_technology: "researching_technology";
            researching_time_efficiency: "researching_time_efficiency";
            reverse_engineering: "reverse_engineering";
        }>;
        cost_index: z.ZodNumber;
    }, z.core.$loose>>;
    solar_system_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetInsurancePricesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetInsurancePricesResponse: z.ZodArray<z.ZodObject<{
    levels: z.ZodArray<z.ZodObject<{
        cost: z.ZodNumber;
        name: z.ZodString;
        payout: z.ZodNumber;
    }, z.core.$loose>>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetKillmailsKillmailIdKillmailHashHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetKillmailsKillmailIdKillmailHashPath: z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetKillmailsKillmailIdKillmailHashResponse: z.ZodObject<{
    attackers: z.ZodArray<z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        character_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        damage_done: z.ZodInt;
        faction_id: z.ZodOptional<z.ZodInt>;
        final_blow: z.ZodBoolean;
        security_status: z.ZodNumber;
        ship_type_id: z.ZodOptional<z.ZodInt>;
        weapon_type_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>;
    killmail_id: z.ZodInt;
    killmail_time: z.ZodISODateTime;
    moon_id: z.ZodOptional<z.ZodInt>;
    solar_system_id: z.ZodInt;
    victim: z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        character_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        damage_taken: z.ZodInt;
        faction_id: z.ZodOptional<z.ZodInt>;
        items: z.ZodOptional<z.ZodArray<z.ZodObject<{
            flag: z.ZodInt;
            item_type_id: z.ZodInt;
            items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                flag: z.ZodInt;
                item_type_id: z.ZodInt;
                quantity_destroyed: z.ZodOptional<z.ZodInt>;
                quantity_dropped: z.ZodOptional<z.ZodInt>;
                singleton: z.ZodInt;
            }, z.core.$loose>>>;
            quantity_destroyed: z.ZodOptional<z.ZodInt>;
            quantity_dropped: z.ZodOptional<z.ZodInt>;
            singleton: z.ZodInt;
        }, z.core.$loose>>>;
        position: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, z.core.$loose>>;
        ship_type_id: z.ZodInt;
    }, z.core.$loose>;
    war_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetLoyaltyStoresCorporationIdOffersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetLoyaltyStoresCorporationIdOffersPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetLoyaltyStoresCorporationIdOffersResponse: z.ZodArray<z.ZodObject<{
    ak_cost: z.ZodOptional<z.ZodInt>;
    isk_cost: z.ZodInt;
    lp_cost: z.ZodInt;
    offer_id: z.ZodInt;
    quantity: z.ZodInt;
    required_items: z.ZodArray<z.ZodObject<{
        quantity: z.ZodInt;
        type_id: z.ZodInt;
    }, z.core.$loose>>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetMarketsGroupsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsGroupsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetMarketsGroupsMarketGroupIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMarketsGroupsMarketGroupIdPath: z.ZodObject<{
    market_group_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsGroupsMarketGroupIdResponse: z.ZodObject<{
    description: z.ZodString;
    market_group_id: z.ZodInt;
    name: z.ZodString;
    parent_group_id: z.ZodOptional<z.ZodInt>;
    types: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetMarketsPricesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsPricesResponse: z.ZodArray<z.ZodObject<{
    adjusted_price: z.ZodOptional<z.ZodNumber>;
    average_price: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetMarketsStructuresStructureIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMarketsStructuresStructureIdPath: z.ZodObject<{
    structure_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetMarketsStructuresStructureIdQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsStructuresStructureIdResponse: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    is_buy_order: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodInt;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetMarketsRegionIdHistoryHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMarketsRegionIdHistoryPath: z.ZodObject<{
    region_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetMarketsRegionIdHistoryQuery: z.ZodObject<{
    type_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsRegionIdHistoryResponse: z.ZodArray<z.ZodObject<{
    average: z.ZodNumber;
    date: z.ZodISODate;
    highest: z.ZodNumber;
    lowest: z.ZodNumber;
    order_count: z.ZodInt;
    volume: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetMarketsRegionIdOrdersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMarketsRegionIdOrdersPath: z.ZodObject<{
    region_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetMarketsRegionIdOrdersQuery: z.ZodObject<{
    order_type: z.ZodDefault<z.ZodEnum<{
        all: "all";
        buy: "buy";
        sell: "sell";
    }>>;
    page: z.ZodOptional<z.ZodInt>;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsRegionIdOrdersResponse: z.ZodArray<z.ZodObject<{
    duration: z.ZodInt;
    is_buy_order: z.ZodBoolean;
    issued: z.ZodISODateTime;
    location_id: z.ZodInt;
    min_volume: z.ZodInt;
    order_id: z.ZodInt;
    price: z.ZodNumber;
    range: z.ZodEnum<{
        1: "1";
        10: "10";
        2: "2";
        20: "20";
        3: "3";
        30: "30";
        4: "4";
        40: "40";
        5: "5";
        region: "region";
        solarsystem: "solarsystem";
        station: "station";
    }>;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
    volume_remain: z.ZodInt;
    volume_total: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetMarketsRegionIdTypesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMarketsRegionIdTypesPath: z.ZodObject<{
    region_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetMarketsRegionIdTypesQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMarketsRegionIdTypesResponse: z.ZodArray<z.ZodInt>;
export declare const zGetMetaChangelogHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMetaChangelogResponse: z.ZodObject<{
    changelog: z.ZodObject<{}, z.core.$catchall<z.ZodArray<z.ZodObject<{
        compatibility_date: z.ZodISODate;
        description: z.ZodString;
        method: z.ZodEnum<{
            DELETE: "DELETE";
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
        }>;
        path: z.ZodString;
        type: z.ZodEnum<{
            breaking: "breaking";
            changed: "changed";
            new: "new";
            removed: "removed";
        }>;
    }, z.core.$loose>>>>;
}, z.core.$loose>;
export declare const zGetMetaCompatibilityDatesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMetaCompatibilityDatesResponse: z.ZodObject<{
    compatibility_dates: z.ZodArray<z.ZodISODate>;
}, z.core.$loose>;
export declare const zGetMetaNameHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMetaNameResponse: z.ZodObject<{
    current: z.ZodString;
    history: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        name: z.ZodString;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetMetaStatusHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMetaStatusResponse: z.ZodObject<{
    routes: z.ZodArray<z.ZodObject<{
        method: z.ZodEnum<{
            DELETE: "DELETE";
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
        }>;
        path: z.ZodString;
        status: z.ZodEnum<{
            Degraded: "Degraded";
            Down: "Down";
            OK: "OK";
            Recovering: "Recovering";
            Unknown: "Unknown";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMilitaryCampaignsListingResponse: z.ZodObject<{
    campaigns: z.ZodArray<z.ZodObject<{
        finished: z.ZodOptional<z.ZodISODateTime>;
        id: z.ZodUUID;
        progress: z.ZodInt;
        started: z.ZodOptional<z.ZodISODateTime>;
        state: z.ZodEnum<{
            Active: "Active";
            Completed: "Completed";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsDetailPath: z.ZodObject<{
    campaign_id: z.ZodUUID;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMilitaryCampaignsDetailResponse: z.ZodObject<{
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodUUID;
    progress: z.ZodInt;
    started: z.ZodOptional<z.ZodISODateTime>;
    state: z.ZodEnum<{
        Active: "Active";
        Completed: "Completed";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsObjectivesListingHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsObjectivesListingPath: z.ZodObject<{
    campaign_id: z.ZodUUID;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsObjectivesListingQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMilitaryCampaignsObjectivesListingResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    objectives: z.ZodArray<z.ZodObject<{
        finished: z.ZodOptional<z.ZodISODateTime>;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        participants: z.ZodObject<{
            committed: z.ZodInt;
            contributors: z.ZodInt;
            total: z.ZodInt;
        }, z.core.$loose>;
        progress: z.ZodInt;
        started: z.ZodOptional<z.ZodISODateTime>;
        state: z.ZodEnum<{
            Active: "Active";
            Completed: "Completed";
            Expired: "Expired";
            Unspecified: "Unspecified";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsObjectivesDetailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetMilitaryCampaignsObjectivesDetailPath: z.ZodObject<{
    campaign_id: z.ZodUUID;
    objective_id: z.ZodUUID;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetMilitaryCampaignsObjectivesDetailResponse: z.ZodObject<{
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodUUID;
    last_modified: z.ZodISODateTime;
    participants: z.ZodObject<{
        committed: z.ZodInt;
        contributors: z.ZodInt;
        total: z.ZodInt;
    }, z.core.$loose>;
    progress: z.ZodInt;
    started: z.ZodOptional<z.ZodISODateTime>;
    state: z.ZodEnum<{
        Active: "Active";
        Completed: "Completed";
        Expired: "Expired";
        Unspecified: "Unspecified";
    }>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetParagonHubSkinrResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrAlliancesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrAlliancesPath: z.ZodObject<{
    alliance_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrAlliancesQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetParagonHubSkinrAlliancesResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrCharactersHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrCharactersPath: z.ZodObject<{
    character_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrCharactersQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetParagonHubSkinrCharactersResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrCorporationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrCorporationsPath: z.ZodObject<{
    corporation_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetParagonHubSkinrCorporationsQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetParagonHubSkinrCorporationsResponse: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    listings: z.ZodArray<z.ZodObject<{
        created: z.ZodISODateTime;
        expires: z.ZodISODateTime;
        id: z.ZodUUID;
        last_modified: z.ZodISODateTime;
        price: z.ZodXor<readonly [z.ZodObject<{
            isk: z.ZodOptional<z.ZodNumber>;
        }, z.core.$loose>, z.ZodObject<{
            plex: z.ZodOptional<z.ZodInt>;
        }, z.core.$loose>]>;
        quantity: z.ZodInt;
        seller_id: z.ZodInt;
        skinr_id: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            listed: "listed";
            removed: "removed";
            sold_out: "sold_out";
        }>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zPostRouteBody: z.ZodObject<{
    avoid_systems: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    connections: z.ZodOptional<z.ZodArray<z.ZodObject<{
        from: z.ZodInt;
        to: z.ZodInt;
    }, z.core.$loose>>>;
    preference: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        LessSecure: "LessSecure";
        Safer: "Safer";
        Shorter: "Shorter";
    }>>>;
    security_penalty: z.ZodDefault<z.ZodOptional<z.ZodInt>>;
}, z.core.$loose>;
export declare const zPostRouteHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostRoutePath: z.ZodObject<{
    origin_system_id: z.ZodInt;
    destination_system_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostRouteResponse: z.ZodObject<{
    route: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetSkyhooksRaidableHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetSkyhooksRaidableResponse: z.ZodObject<{
    skyhooks: z.ZodArray<z.ZodObject<{
        planet_id: z.ZodInt;
        solar_system_id: z.ZodInt;
        theft_vulnerability: z.ZodObject<{
            end: z.ZodISODateTime;
            start: z.ZodISODateTime;
        }, z.core.$loose>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetSovereigntyCampaignsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetSovereigntyCampaignsResponse: z.ZodArray<z.ZodObject<{
    attackers_score: z.ZodOptional<z.ZodNumber>;
    campaign_id: z.ZodInt;
    constellation_id: z.ZodInt;
    defender_id: z.ZodOptional<z.ZodInt>;
    defender_score: z.ZodOptional<z.ZodNumber>;
    event_type: z.ZodEnum<{
        ihub_defense: "ihub_defense";
        station_defense: "station_defense";
        station_freeport: "station_freeport";
        tcu_defense: "tcu_defense";
    }>;
    participants: z.ZodOptional<z.ZodArray<z.ZodObject<{
        alliance_id: z.ZodInt;
        score: z.ZodNumber;
    }, z.core.$loose>>>;
    solar_system_id: z.ZodInt;
    start_time: z.ZodISODateTime;
    structure_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetSovereigntySystemsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetSovereigntySystemsResponse: z.ZodObject<{
    solar_systems: z.ZodArray<z.ZodObject<{
        claim: z.ZodXor<readonly [z.ZodObject<{
            faction: z.ZodOptional<z.ZodObject<{
                faction_id: z.ZodInt;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            alliance: z.ZodOptional<z.ZodObject<{
                alliance_id: z.ZodInt;
                claimed_since: z.ZodISODateTime;
                corporation_id: z.ZodInt;
                development: z.ZodObject<{
                    activity_defense_multiplier: z.ZodNumber;
                    industrial_level: z.ZodInt;
                    military_level: z.ZodInt;
                    strategic_level: z.ZodInt;
                }, z.core.$loose>;
                is_capital_system: z.ZodBoolean;
                sovereignty_hub: z.ZodObject<{
                    id: z.ZodInt;
                    vulnerability_window: z.ZodOptional<z.ZodObject<{
                        end: z.ZodISODateTime;
                        start: z.ZodISODateTime;
                    }, z.core.$loose>>;
                }, z.core.$loose>;
            }, z.core.$loose>>;
        }, z.core.$loose>, z.ZodObject<{
            unclaimed: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>]>;
        solar_system_id: z.ZodInt;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const zGetStatusHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetStatusResponse: z.ZodObject<{
    players: z.ZodInt;
    server_version: z.ZodString;
    start_time: z.ZodISODateTime;
    vip: z.ZodBoolean;
}, z.core.$loose>;
export declare const zPostUiAutopilotWaypointHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostUiAutopilotWaypointQuery: z.ZodObject<{
    add_to_beginning: z.ZodDefault<z.ZodBoolean>;
    clear_other_waypoints: z.ZodDefault<z.ZodBoolean>;
    destination_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Open window request received
 */
export declare const zPostUiAutopilotWaypointResponse: z.ZodUndefined;
export declare const zPostUiOpenwindowContractHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostUiOpenwindowContractQuery: z.ZodObject<{
    contract_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Open window request received
 */
export declare const zPostUiOpenwindowContractResponse: z.ZodUndefined;
export declare const zPostUiOpenwindowInformationHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostUiOpenwindowInformationQuery: z.ZodObject<{
    target_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Open window request received
 */
export declare const zPostUiOpenwindowInformationResponse: z.ZodUndefined;
export declare const zPostUiOpenwindowMarketdetailsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zPostUiOpenwindowMarketdetailsQuery: z.ZodObject<{
    type_id: z.ZodInt;
}, z.core.$loose>;
/**
 * Open window request received
 */
export declare const zPostUiOpenwindowMarketdetailsResponse: z.ZodUndefined;
export declare const zPostUiOpenwindowNewmailBody: z.ZodObject<{
    body: z.ZodString;
    recipients: z.ZodArray<z.ZodInt>;
    subject: z.ZodString;
    to_corp_or_alliance_id: z.ZodOptional<z.ZodInt>;
    to_mailing_list_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zPostUiOpenwindowNewmailHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * Open window request received
 */
export declare const zPostUiOpenwindowNewmailResponse: z.ZodUndefined;
export declare const zGetUniverseAncestriesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseAncestriesResponse: z.ZodArray<z.ZodObject<{
    bloodline_id: z.ZodInt;
    description: z.ZodString;
    icon_id: z.ZodOptional<z.ZodInt>;
    id: z.ZodInt;
    name: z.ZodString;
    short_description: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>;
export declare const zGetUniverseAsteroidBeltsAsteroidBeltIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseAsteroidBeltsAsteroidBeltIdPath: z.ZodObject<{
    asteroid_belt_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseAsteroidBeltsAsteroidBeltIdResponse: z.ZodObject<{
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseBloodlinesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseBloodlinesResponse: z.ZodArray<z.ZodObject<{
    bloodline_id: z.ZodInt;
    charisma: z.ZodInt;
    corporation_id: z.ZodInt;
    description: z.ZodString;
    intelligence: z.ZodInt;
    memory: z.ZodInt;
    name: z.ZodString;
    perception: z.ZodInt;
    race_id: z.ZodInt;
    ship_type_id: z.ZodInt;
    willpower: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetUniverseCategoriesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseCategoriesResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseCategoriesCategoryIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseCategoriesCategoryIdPath: z.ZodObject<{
    category_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseCategoriesCategoryIdResponse: z.ZodObject<{
    category_id: z.ZodInt;
    groups: z.ZodArray<z.ZodInt>;
    name: z.ZodString;
    published: z.ZodBoolean;
}, z.core.$loose>;
export declare const zGetUniverseConstellationsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseConstellationsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseConstellationsConstellationIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseConstellationsConstellationIdPath: z.ZodObject<{
    constellation_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseConstellationsConstellationIdResponse: z.ZodObject<{
    constellation_id: z.ZodInt;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    region_id: z.ZodInt;
    systems: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetUniverseFactionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseFactionsResponse: z.ZodArray<z.ZodObject<{
    corporation_id: z.ZodOptional<z.ZodInt>;
    description: z.ZodString;
    faction_id: z.ZodInt;
    is_unique: z.ZodBoolean;
    militia_corporation_id: z.ZodOptional<z.ZodInt>;
    name: z.ZodString;
    size_factor: z.ZodNumber;
    solar_system_id: z.ZodOptional<z.ZodInt>;
    station_count: z.ZodInt;
    station_system_count: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetUniverseGraphicsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseGraphicsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseGraphicsGraphicIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseGraphicsGraphicIdPath: z.ZodObject<{
    graphic_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseGraphicsGraphicIdResponse: z.ZodObject<{
    collision_file: z.ZodOptional<z.ZodString>;
    graphic_file: z.ZodOptional<z.ZodString>;
    graphic_id: z.ZodInt;
    icon_folder: z.ZodOptional<z.ZodString>;
    sof_dna: z.ZodOptional<z.ZodString>;
    sof_fation_name: z.ZodOptional<z.ZodString>;
    sof_hull_name: z.ZodOptional<z.ZodString>;
    sof_race_name: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseGroupsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseGroupsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseGroupsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseGroupsGroupIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseGroupsGroupIdPath: z.ZodObject<{
    group_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseGroupsGroupIdResponse: z.ZodObject<{
    category_id: z.ZodInt;
    group_id: z.ZodInt;
    name: z.ZodString;
    published: z.ZodBoolean;
    types: z.ZodArray<z.ZodInt>;
}, z.core.$loose>;
export declare const zPostUniverseIdsBody: z.ZodArray<z.ZodString>;
export declare const zPostUniverseIdsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostUniverseIdsResponse: z.ZodObject<{
    agents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    alliances: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    characters: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    constellations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    corporations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    factions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    inventory_types: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    regions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    stations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    systems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodInt>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const zGetUniverseMoonsMoonIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseMoonsMoonIdPath: z.ZodObject<{
    moon_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseMoonsMoonIdResponse: z.ZodObject<{
    moon_id: z.ZodInt;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zPostUniverseNamesBody: z.ZodArray<z.ZodInt>;
export declare const zPostUniverseNamesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zPostUniverseNamesResponse: z.ZodArray<z.ZodObject<{
    category: z.ZodEnum<{
        alliance: "alliance";
        character: "character";
        constellation: "constellation";
        corporation: "corporation";
        faction: "faction";
        inventory_type: "inventory_type";
        region: "region";
        solar_system: "solar_system";
        station: "station";
    }>;
    id: z.ZodInt;
    name: z.ZodString;
}, z.core.$loose>>;
export declare const zGetUniversePlanetsPlanetIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniversePlanetsPlanetIdPath: z.ZodObject<{
    planet_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniversePlanetsPlanetIdResponse: z.ZodObject<{
    name: z.ZodString;
    planet_id: z.ZodInt;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseRacesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseRacesResponse: z.ZodArray<z.ZodObject<{
    alliance_id: z.ZodInt;
    description: z.ZodString;
    name: z.ZodString;
    race_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetUniverseRegionsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseRegionsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseRegionsRegionIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseRegionsRegionIdPath: z.ZodObject<{
    region_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseRegionsRegionIdResponse: z.ZodObject<{
    constellations: z.ZodArray<z.ZodInt>;
    description: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    region_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseSchematicsSchematicIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseSchematicsSchematicIdPath: z.ZodObject<{
    schematic_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseSchematicsSchematicIdResponse: z.ZodObject<{
    cycle_time: z.ZodInt;
    schematic_name: z.ZodString;
}, z.core.$loose>;
export declare const zGetUniverseStargatesStargateIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseStargatesStargateIdPath: z.ZodObject<{
    stargate_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseStargatesStargateIdResponse: z.ZodObject<{
    destination: z.ZodObject<{
        stargate_id: z.ZodInt;
        system_id: z.ZodInt;
    }, z.core.$loose>;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    stargate_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseStarsStarIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseStarsStarIdPath: z.ZodObject<{
    star_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseStarsStarIdResponse: z.ZodObject<{
    age: z.ZodInt;
    luminosity: z.ZodNumber;
    name: z.ZodString;
    radius: z.ZodInt;
    solar_system_id: z.ZodInt;
    spectral_class: z.ZodEnum<{
        A0: "A0";
        A0IV: "A0IV";
        A0IV2: "A0IV2";
        "F0 IV": "F0 IV";
        "F0 V": "F0 V";
        "F0 VI": "F0 VI";
        "F1 IV": "F1 IV";
        "F1 V": "F1 V";
        "F1 VI": "F1 VI";
        "F2 IV": "F2 IV";
        "F2 V": "F2 V";
        "F2 VI": "F2 VI";
        "F3 IV": "F3 IV";
        "F3 V": "F3 V";
        "F3 VI": "F3 VI";
        "F4 IV": "F4 IV";
        "F4 V": "F4 V";
        "F4 VI": "F4 VI";
        "F5 IV": "F5 IV";
        "F5 V": "F5 V";
        "F5 VI": "F5 VI";
        "F6 IV": "F6 IV";
        "F6 V": "F6 V";
        "F6 VI": "F6 VI";
        "F7 V": "F7 V";
        "F7 VI": "F7 VI";
        "F8 V": "F8 V";
        "F8 VI": "F8 VI";
        "F9 IV": "F9 IV";
        "F9 V": "F9 V";
        "F9 VI": "F9 VI";
        "G0 IV": "G0 IV";
        "G0 V": "G0 V";
        "G0 VI": "G0 VI";
        "G1 IV": "G1 IV";
        "G1 V": "G1 V";
        "G1 VI": "G1 VI";
        "G2 IV": "G2 IV";
        "G2 V": "G2 V";
        "G2 VI": "G2 VI";
        "G3 IV": "G3 IV";
        "G3 V": "G3 V";
        "G3 VI": "G3 VI";
        "G4 IV": "G4 IV";
        "G4 V": "G4 V";
        "G4 VI": "G4 VI";
        "G5 IV": "G5 IV";
        "G5 V": "G5 V";
        "G5 VI": "G5 VI";
        "G6 V": "G6 V";
        "G6 VI": "G6 VI";
        "G7 IV": "G7 IV";
        "G7 V": "G7 V";
        "G7 VI": "G7 VI";
        "G8 IV": "G8 IV";
        "G8 V": "G8 V";
        "G8 VI": "G8 VI";
        "G9 V": "G9 V";
        "G9 VI": "G9 VI";
        "K0 IV": "K0 IV";
        "K0 V": "K0 V";
        "K1 IV": "K1 IV";
        "K1 V": "K1 V";
        "K2 IV": "K2 IV";
        "K2 V": "K2 V";
        "K3 IV": "K3 IV";
        "K3 V": "K3 V";
        "K4 IV": "K4 IV";
        "K4 V": "K4 V";
        "K5 IV": "K5 IV";
        "K5 V": "K5 V";
        "K6 IV": "K6 IV";
        "K6 V": "K6 V";
        "K7 IV": "K7 IV";
        "K7 V": "K7 V";
        "K8 IV": "K8 IV";
        "K8 V": "K8 V";
        "K9 IV": "K9 IV";
        "K9 V": "K9 V";
        "M0 V": "M0 V";
        "M1 V": "M1 V";
        "M2 V": "M2 V";
        "M3 V": "M3 V";
        "M4 V": "M4 V";
        "M5 V": "M5 V";
        "M6 V": "M6 V";
        "M7 V": "M7 V";
        "M8 V": "M8 V";
        "M9 V": "M9 V";
    }>;
    temperature: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseStationsStationIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseStationsStationIdPath: z.ZodObject<{
    station_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseStationsStationIdResponse: z.ZodObject<{
    max_dockable_ship_volume: z.ZodNumber;
    name: z.ZodString;
    office_rental_cost: z.ZodNumber;
    owner: z.ZodOptional<z.ZodInt>;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    race_id: z.ZodOptional<z.ZodInt>;
    reprocessing_efficiency: z.ZodNumber;
    reprocessing_stations_take: z.ZodNumber;
    services: z.ZodArray<z.ZodEnum<{
        "assasination-missions": "assasination-missions";
        "black-market": "black-market";
        "bounty-missions": "bounty-missions";
        cloning: "cloning";
        "courier-missions": "courier-missions";
        "dna-therapy": "dna-therapy";
        docking: "docking";
        factory: "factory";
        fitting: "fitting";
        gambling: "gambling";
        insurance: "insurance";
        interbus: "interbus";
        "jump-clone-facility": "jump-clone-facility";
        labratory: "labratory";
        "loyalty-point-store": "loyalty-point-store";
        market: "market";
        "navy-offices": "navy-offices";
        news: "news";
        "office-rental": "office-rental";
        paintshop: "paintshop";
        refinery: "refinery";
        "repair-facilities": "repair-facilities";
        "reprocessing-plant": "reprocessing-plant";
        "security-offices": "security-offices";
        "stock-exchange": "stock-exchange";
        storage: "storage";
        surgery: "surgery";
    }>>;
    station_id: z.ZodInt;
    system_id: z.ZodInt;
    type_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseStructuresHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseStructuresQuery: z.ZodObject<{
    filter: z.ZodOptional<z.ZodEnum<{
        manufacturing_basic: "manufacturing_basic";
        market: "market";
    }>>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseStructuresResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseStructuresStructureIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseStructuresStructureIdPath: z.ZodObject<{
    structure_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseStructuresStructureIdResponse: z.ZodObject<{
    name: z.ZodString;
    owner_id: z.ZodInt;
    position: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>>;
    solar_system_id: z.ZodInt;
    type_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
export declare const zGetUniverseSystemJumpsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseSystemJumpsResponse: z.ZodArray<z.ZodObject<{
    ship_jumps: z.ZodInt;
    system_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetUniverseSystemKillsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseSystemKillsResponse: z.ZodArray<z.ZodObject<{
    npc_kills: z.ZodInt;
    pod_kills: z.ZodInt;
    ship_kills: z.ZodInt;
    system_id: z.ZodInt;
}, z.core.$loose>>;
export declare const zGetUniverseSystemsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseSystemsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseSystemsSystemIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseSystemsSystemIdPath: z.ZodObject<{
    system_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseSystemsSystemIdResponse: z.ZodObject<{
    constellation_id: z.ZodInt;
    name: z.ZodString;
    planets: z.ZodOptional<z.ZodArray<z.ZodObject<{
        asteroid_belts: z.ZodOptional<z.ZodArray<z.ZodInt>>;
        moons: z.ZodOptional<z.ZodArray<z.ZodInt>>;
        planet_id: z.ZodInt;
    }, z.core.$loose>>>;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, z.core.$loose>;
    security_class: z.ZodOptional<z.ZodString>;
    security_status: z.ZodNumber;
    star_id: z.ZodOptional<z.ZodInt>;
    stargates: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    stations: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    system_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetUniverseTypesHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseTypesQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseTypesResponse: z.ZodArray<z.ZodInt>;
export declare const zGetUniverseTypesTypeIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetUniverseTypesTypeIdPath: z.ZodObject<{
    type_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetUniverseTypesTypeIdResponse: z.ZodObject<{
    capacity: z.ZodOptional<z.ZodNumber>;
    description: z.ZodString;
    dogma_attributes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        attribute_id: z.ZodInt;
        value: z.ZodNumber;
    }, z.core.$loose>>>;
    dogma_effects: z.ZodOptional<z.ZodArray<z.ZodObject<{
        effect_id: z.ZodInt;
        is_default: z.ZodBoolean;
    }, z.core.$loose>>>;
    graphic_id: z.ZodOptional<z.ZodInt>;
    group_id: z.ZodInt;
    icon_id: z.ZodOptional<z.ZodInt>;
    market_group_id: z.ZodOptional<z.ZodInt>;
    mass: z.ZodOptional<z.ZodNumber>;
    name: z.ZodString;
    packaged_volume: z.ZodOptional<z.ZodNumber>;
    portion_size: z.ZodOptional<z.ZodInt>;
    published: z.ZodBoolean;
    radius: z.ZodOptional<z.ZodNumber>;
    type_id: z.ZodInt;
    volume: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const zGetWarsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetWarsQuery: z.ZodObject<{
    max_war_id: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetWarsResponse: z.ZodArray<z.ZodInt>;
export declare const zGetWarsWarIdHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetWarsWarIdPath: z.ZodObject<{
    war_id: z.ZodInt;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetWarsWarIdResponse: z.ZodObject<{
    aggressor: z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        isk_destroyed: z.ZodNumber;
        ships_killed: z.ZodInt;
    }, z.core.$loose>;
    allies: z.ZodOptional<z.ZodArray<z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
    }, z.core.$loose>>>;
    declared: z.ZodISODateTime;
    defender: z.ZodObject<{
        alliance_id: z.ZodOptional<z.ZodInt>;
        corporation_id: z.ZodOptional<z.ZodInt>;
        isk_destroyed: z.ZodNumber;
        ships_killed: z.ZodInt;
    }, z.core.$loose>;
    finished: z.ZodOptional<z.ZodISODateTime>;
    id: z.ZodInt;
    mutual: z.ZodBoolean;
    open_for_allies: z.ZodBoolean;
    retracted: z.ZodOptional<z.ZodISODateTime>;
    started: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$loose>;
export declare const zGetWarsWarIdKillmailsHeaders: z.ZodObject<{
    'If-None-Match': z.ZodOptional<z.ZodString>;
    'X-Tenant': z.ZodDefault<z.ZodOptional<z.ZodString>>;
    'If-Modified-Since': z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const zGetWarsWarIdKillmailsPath: z.ZodObject<{
    war_id: z.ZodInt;
}, z.core.$loose>;
export declare const zGetWarsWarIdKillmailsQuery: z.ZodObject<{
    page: z.ZodOptional<z.ZodInt>;
}, z.core.$loose>;
/**
 * OK
 */
export declare const zGetWarsWarIdKillmailsResponse: z.ZodArray<z.ZodObject<{
    killmail_hash: z.ZodString;
    killmail_id: z.ZodInt;
}, z.core.$loose>>;
