import test from 'ava'
import { dashboardAppUrl, toProjectId } from './dashboard_url'

test('app links use the project_ form', t => {
  t.is(
    dashboardAppUrl('team_6ad5de5a', 'app_1'),
    'https://dashboard.faable.com/deploy/project_6ad5de5a/app/app_1'
  )
})

test('a project_ id passes through untouched', t => {
  t.is(toProjectId('project_abc'), 'project_abc')
})
