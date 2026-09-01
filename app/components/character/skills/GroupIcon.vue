<script setup lang="ts">
import type { SkillGroupIcon } from '../../../utils/skill-group-icons'

defineProps<{
  name: SkillGroupIcon
}>()
</script>

<template>
  <svg class="skill-group-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <template v-if="name === 'armor'">
      <path d="M12 3.2 4.6 6v6.1c0 4.3 3.1 7.2 7.4 8.7 4.3-1.5 7.4-4.4 7.4-8.7V6Z" />
      <path d="M8.1 9.4 12 11l3.9-1.6M8.1 13.4 12 15l3.9-1.6" />
    </template>
    <template v-else-if="name === 'shields'">
      <path d="M3.2 16.8a8.8 8.8 0 0 1 17.6 0" />
      <path d="M5.1 18.7a6.9 6.9 0 0 1 13.8 0" />
      <path d="M7 20.6a5 5 0 0 1 10 0" />
      <path d="M12 4.2v3.2" />
    </template>
    <template v-else-if="name === 'rigging'">
      <path d="M6.4 4.6H4.4v14.8h2M17.6 4.6h2v14.8h-2" />
      <path d="M8.6 12h6.8M12 9.2v5.6" />
    </template>
    <template v-else-if="name === 'subsystems'">
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <path d="M13.6 16.4h6.8M17 13v6.8" />
    </template>
    <template v-else-if="name === 'gunnery'">
      <g transform="rotate(-35 12 12)">
        <path
          d="M19.5 12c-1.9-1.9-3.5-2.3-4.8-2.4l-1.7-1.2H5.5v7.2h7.4l1.7-1.2c1.4-.1 2.9-.5 4.8-2.4Z"
        />
        <path d="M14.7 9.6v4.8" />
        <path d="M13 8.4v7.2" />
        <path d="M4.5 7.4v9.2" />
      </g>
    </template>
    <template v-else-if="name === 'missiles'">
      <path d="M7.6 3.6c1.6 1.4 2.4 2.9 2.4 4.5v4.6H5.2V8.1c0-1.6.8-3.1 2.4-4.5Z" />
      <path d="M5.2 9.6 3.6 11.4v2l1.6-1.4M10 9.6l1.6 1.8v2L10 13.4" />
      <path d="M7.6 14.9v2.6" />
      <path d="M16.4 6.6c1.6 1.4 2.4 2.9 2.4 4.5v4.6h-4.8v-4.6c0-1.6.8-3.1 2.4-4.5Z" />
      <path d="M14 12.6 12.4 14.4v2l1.6-1.4M18.8 12.6l1.6 1.8v2l-1.6-1.4" />
      <path d="M16.4 17.9v2.6" />
    </template>
    <template v-else-if="name === 'drones'">
      <rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1" />
      <path d="M9.4 9.4 5.4 5M14.6 9.4 18.6 5M9.4 14.6 5.4 19M14.6 14.6 18.6 19" />
      <path d="M3.2 5h4.4M16.4 5h4.4M3.2 19h4.4M16.4 19h4.4" />
    </template>
    <template v-else-if="name === 'targeting'">
      <circle cx="12" cy="12" r="6.4" />
      <path d="M12 3.2v3M12 17.8v3M3.2 12h3M17.8 12h3" />
    </template>
    <template v-else-if="name === 'electronic-systems'">
      <rect x="8.6" y="8.6" width="6.8" height="6.8" />
      <path
        d="M10.3 8.6V3.6M13.7 8.6V3.6M10.3 15.4v5M13.7 15.4v5M8.6 10.3H3.6M8.6 13.7H3.6M15.4 10.3h5M15.4 13.7h5"
      />
    </template>
    <template v-else-if="name === 'engineering'">
      <circle cx="12" cy="4.9" r="1.7" />
      <path d="M11.1 6.4 4.8 20.4l2.8-1.7" />
      <path d="M12.9 6.4 19.2 20.4l-2.8-1.7" />
      <path d="M8.2 14a7.6 7.6 0 0 0 7.6 0" />
    </template>
    <template v-else-if="name === 'navigation'">
      <path d="M3.4 20.6 20.6 3.4l-6 17.2-3-7.5Z" />
    </template>
    <template v-else-if="name === 'scanning'">
      <circle cx="10.6" cy="12" r="1.6" />
      <path d="M14.2 8.4a5.1 5.1 0 0 1 0 7.2M17 5.6a9 9 0 0 1 0 12.8M7 15.6a5.1 5.1 0 0 1 0-7.2" />
    </template>
    <template v-else-if="name === 'spaceship-command'">
      <path d="M12 3.4 18.8 15.4H5.2Z" />
      <path d="M6.4 18.2h11.2M9 20.6h6" />
    </template>
    <template v-else-if="name === 'fleet-support'">
      <path d="M12 3.4 15.4 9.4H8.6Z" />
      <path d="M5.8 13.8 8.4 19H3.2ZM18.2 13.8 20.8 19h-5.2Z" />
      <path d="M12 9.8v3.4M5.8 13.2h12.4" />
    </template>
    <template v-else-if="name === 'science'">
      <path d="M8.8 3.4h6.4M10 3.4v5.2L5 17.6a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3L14 8.6V3.4" />
      <path d="M7.4 14.6h9.2" />
    </template>
    <template v-else-if="name === 'production'">
      <path d="M3.6 20.4V9.6l4.6 3V9.6l4.6 3V9.6l4.6 3V6.4h3.2v14Z" />
      <path d="M3.6 16.4h16.8" />
    </template>
    <template v-else-if="name === 'resource-processing'">
      <path d="M12.8 4.8l5.7 9.9" />
      <path d="M16.4 13.5 18.5 14.7V12.3" />
      <path d="M18.6 17.6H7.2" />
      <path d="M9.3 16.4 7.2 17.6l2.1 1.2" />
      <path d="M5.4 14.7l5.8-9.9" />
      <path d="M11.2 7.2V4.8L9.1 6" />
    </template>
    <template v-else-if="name === 'trade'">
      <path d="M3.4 8.6h17.2M16.8 4.8l3.8 3.8-3.8 3.8" />
      <path d="M20.6 15.4H3.4M7.2 11.6l-3.8 3.8 3.8 3.8" />
    </template>
    <template v-else-if="name === 'planet-management'">
      <circle cx="12" cy="12" r="6.4" />
      <path d="M20.8 8.8A9.4 3.4 -20 0 1 3.2 15.2" />
    </template>
    <template v-else-if="name === 'structure-management'">
      <path d="M12 3.2 19.4 7.6v8.8L12 20.8 4.6 16.4V7.6Z" />
      <path d="M12 9.6 15.8 12v3.2L12 17.4l-3.8-2.2V12Z" />
    </template>
    <template v-else-if="name === 'social'">
      <circle cx="12" cy="7.4" r="2.8" />
      <path d="M7.2 17.4a4.8 4.8 0 0 1 9.6 0" />
      <circle cx="5.4" cy="11.4" r="2.2" />
      <path d="M3.2 20.2a3.4 3.4 0 0 1 3.6-3.3" />
      <circle cx="18.6" cy="11.4" r="2.2" />
      <path d="M20.8 20.2a3.4 3.4 0 0 0-3.6-3.3" />
    </template>
    <template v-else-if="name === 'corporation-management'">
      <path d="M4.4 20.4V6.4l8-3.2v17.2Z" />
      <path d="M12.4 20.4V10.4l7.2 2.4v7.6Z" />
      <path d="M7.2 10h2.4M7.2 14h2.4M15.2 15.6h1.6" />
    </template>
    <template v-else-if="name === 'neural-enhancement'">
      <path
        d="M12 4.6a3.4 3.4 0 0 0-6.3 1.5 3.2 3.2 0 0 0-1.6 5.2 3.4 3.4 0 0 0 1.4 5.2 3.2 3.2 0 0 0 6.5 1.3Z"
      />
      <path
        d="M12 4.6a3.4 3.4 0 0 1 6.3 1.5 3.2 3.2 0 0 1 1.6 5.2 3.4 3.4 0 0 1-1.4 5.2 3.2 3.2 0 0 1-6.5 1.3Z"
      />
      <path d="M12 4.6v14.6" />
      <path
        d="M8.6 8.4c1.2.4 2 1.3 2.2 2.6M15.4 8.4c-1.2.4-2 1.3-2.2 2.6M9.2 15.4c1-.5 1.6-1.3 1.6-2.4M14.8 15.4c-1-.5-1.6-1.3-1.6-2.4"
      />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 15.4v-2a2.6 2.6 0 1 0-2.6-2.6" />
      <path d="M12 17.8h.01" />
    </template>
  </svg>
</template>
