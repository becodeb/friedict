/**
 * Una predicción con todo lo que la tarjeta del feed necesita.
 *
 * Vive en su propio módulo, sin importar `express` ni nada del resto del
 * servidor, para poder ejercitarla directamente desde `integration/` contra
 * la base real sin tener que levantar el proceso HTTP — el mismo texto SQL
 * que corre en producción, probado tal cual.
 *
 * Detalle que importa: `tally` y `votes` NO se filtran acá. La RLS de
 * `prediction_option_tallies` implementa `results_visibility` y la de
 * `prediction_votes` implementa `votes_visibility`, así que la subconsulta
 * devuelve null o lista vacía sola cuando no corresponde verlos. Es el mismo
 * comportamiento que tenían los embeds de PostgREST.
 *
 * `member_count`, `required_participants`, `close_required` y
 * `my_close_request` son derivados: el cliente no conoce el tamaño del grupo,
 * así que el requisito de calificación y de cierre se calculan acá, del lado
 * del servidor, y viajan ya resueltos en la fila.
 */
export const PREDICTION_SELECT = `
  select
    p.*,
    mc.member_count,
    public.required_participants(mc.member_count, p.qualification_percent) as required_participants,
    public.required_close_requests(mc.member_count, p.close_percent)       as close_required,
    exists (
      select 1 from public.prediction_close_requests q
       where q.prediction_id = p.id and q.user_id = (select public.current_user_id())
    ) as my_close_request,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'prediction_id', o.prediction_id,
          'label', o.label,
          'position', o.position,
          'member_id', o.member_id,
          'created_by', o.created_by,
          'created_at', o.created_at,
          'tally', case
            when t.option_id is null then null
            else jsonb_build_object('vote_count', t.vote_count, 'voter_count', t.voter_count)
          end
        )
        order by o.position
      )
      from public.prediction_options o
      left join public.prediction_option_tallies t on t.option_id = o.id
      where o.prediction_id = p.id
    ), '[]'::jsonb) as options,
    coalesce((
      select jsonb_agg(to_jsonb(v) order by v.cycle, v.created_at)
      from public.prediction_votes v
      where v.prediction_id = p.id
    ), '[]'::jsonb) as votes,
    (
      select jsonb_build_object(
        'id', pr.id,
        'display_name', pr.display_name,
        'avatar_seed', pr.avatar_seed,
        'accent', pr.accent
      )
      from public.profiles pr
      where pr.id = p.created_by
    ) as author
  from public.predictions p
  left join lateral (
    select count(*)::integer as member_count
      from public.group_members gm
     where gm.group_id = p.group_id
  ) mc on true
`
