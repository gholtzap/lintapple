<script setup lang="ts">
defineProps<{ size?: 'sm' | 'default' }>();
</script>

<template>
  <button :class="size === 'sm' ? 'px-3 py-1' : 'px-4 py-2'"><slot /></button>
</template>
