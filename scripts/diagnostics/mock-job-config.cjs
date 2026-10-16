// Synthetic version lineage for built-in Mock diagnostics; no provider credentials.
exports.mockJobConfig = async function(db, provider = 'mock') {
  const [identity] = await db`insert into llm_model_configs(name) values(${provider}) returning id`;
  const [version] = await db`insert into llm_model_config_versions(config_id,version,provider,base_url,model_name)
    values(${identity.id},1,${provider},'http://127.0.0.1:1','diagnostic-mock') returning id`;
  await db`update llm_model_configs set current_version_id=${version.id} where id=${identity.id}`;
  return {quick_model_version_id:version.id,deep_model_version_id:version.id,configuration_state:'versioned'};
};
