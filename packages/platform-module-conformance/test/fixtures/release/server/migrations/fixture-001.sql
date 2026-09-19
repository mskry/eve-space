create function eve_module_fixture.persist_read_fixture(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return jsonb_build_object('value', input->>'id');
