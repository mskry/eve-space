import { definePlatformResourceOperation, } from '@eve-space/platform-module-contract/resources';
export const conformanceStatusResource = definePlatformResourceOperation({
    operation: 'conformance-status-operation',
    async collect(context) {
        const observation = await context.execute('conformance-status-operation', {});
        const data = observation.data;
        const typeGroups = await context.capabilities.coreData.publishedTypeGroups({ typeIds: [34] });
        return {
            complete: true,
            data: {
                players: data.players,
                publishedTypeCount: typeGroups.rows.length,
                sdeBuildNumber: typeGroups.revision.buildNumber,
            },
        };
    },
    request(_subject) {
        return {};
    },
    map({ data }) {
        return { players: data.players };
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
