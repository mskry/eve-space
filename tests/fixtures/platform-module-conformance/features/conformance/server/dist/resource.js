import { definePlatformBoundedCollectionResource, definePlatformSingleRequestResource, } from '@eve-space/platform-module-contract/resources';
export const conformanceStatusResource = definePlatformSingleRequestResource({
    mode: 'single-request',
    operation: 'conformance-status-operation',
    request: () => ({}),
    async map({ data, capabilities }) {
        const typeGroups = await capabilities.coreData.publishedTypeGroups({ typeIds: [34] });
        return {
            players: data.players,
            publishedTypeCount: typeGroups.rows.length,
            sdeBuildNumber: typeGroups.revision.buildNumber,
        };
    },
    materialize: materializeConformanceStatus,
});
export const conformanceCollectionResource = definePlatformBoundedCollectionResource({
    mode: 'bounded-collection',
    operation: 'conformance-status-operation',
    async collect(context) {
        const previous = await context.capabilities.persistence.readConformanceSnapshot({
            characterId: context.subject.characterId,
        });
        const status = await context.operations['conformance-status-operation']({});
        const names = await context.operations['universe-resolve-names']({
            body: [context.subject.characterId],
        });
        return {
            complete: true,
            data: {
                players: status.data.players,
                characterName: names.data.find(({ id }) => id === context.subject.characterId)?.name ?? null,
                previousPlayers: previous?.pilotsOnline ?? null,
            },
        };
    },
    materialize: materializeConformanceStatus,
});
async function materializeConformanceStatus({ subject, data, validatedAt, capabilities, }) {
    await capabilities.persistence.upsertConformanceSnapshot({
        characterId: subject.characterId,
        pilotsOnline: data.players,
        validatedAt,
    });
    capabilities.logger.info('conformance.resource.materialized', {
        characterId: subject.characterId,
    });
}
