const moduleName = "../services/goalService";

export async function loadDynamicService() {
  return import(moduleName);
}
