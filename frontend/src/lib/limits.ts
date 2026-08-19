// One source of truth for the project cap shown in the account UI. Matches the backend's own
// enforced limit (services/projects.py::_MAX_PROJECTS_PER_OWNER, api-contract.md §15) — kept as
// a separate constant here since the frontend has no generated schema to read it from.
export const PROJECT_CAP = 3;
