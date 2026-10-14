import test from 'ava'
import {
  apply_field_changes,
  format_field,
  parse_field_spec,
  parse_fields_json
} from './profile_fields'

test('a bare key is a string field with the default length', t => {
  t.deepEqual(parse_field_spec('profile'), { key: 'profile', type: 'string' })
})

test('string with a max length, enum with its values', t => {
  t.deepEqual(parse_field_spec('school:string:120'), {
    key: 'school',
    type: 'string',
    max_length: 120
  })
  t.deepEqual(parse_field_spec('profile:enum:student, teacher,student'), {
    key: 'profile',
    type: 'enum',
    options: ['student', 'teacher']
  })
  // A value may itself contain ':'.
  t.deepEqual(parse_field_spec('slot:enum:09:00,10:00'), {
    key: 'slot',
    type: 'enum',
    options: ['09:00', '10:00']
  })
})

test('bad specs say what is wrong', t => {
  t.throws(() => parse_field_spec('Profile'), { message: /lowercase/ })
  t.throws(() => parse_field_spec('profile:enum'), {
    message: /needs its values/
  })
  t.throws(() => parse_field_spec('school:string:0'), { message: /1 to 1000/ })
  t.throws(() => parse_field_spec('school:string:abc'), {
    message: /1 to 1000/
  })
  t.throws(() => parse_field_spec('school:number'), { message: /unknown type/ })
})

test('adding a declared key replaces it in place; new keys go last', t => {
  const out = apply_field_changes(
    [
      { key: 'a', type: 'string' },
      { key: 'b', type: 'string' }
    ],
    [
      { key: 'a', type: 'string', max_length: 10 },
      { key: 'c', type: 'string' }
    ],
    []
  )
  t.deepEqual(out, [
    { key: 'a', type: 'string', max_length: 10 },
    { key: 'b', type: 'string' },
    { key: 'c', type: 'string' }
  ])
})

test('a client with no list of its own starts from empty', t => {
  t.deepEqual(apply_field_changes(null, [{ key: 'x', type: 'string' }], []), [
    { key: 'x', type: 'string' }
  ])
})

test('removing an undeclared key is an error, not a silent no-op', t => {
  t.throws(
    () => apply_field_changes([{ key: 'a', type: 'string' }], [], ['b']),
    {
      message: /no field "b".*declared: a/
    }
  )
})

test('more than 20 fields is refused before the request', t => {
  const many = Array.from({ length: 21 }, (_, i) => ({
    key: `f${i}`,
    type: 'string' as const
  }))
  t.throws(() => apply_field_changes([], many, []), { message: /at most 20/ })
})

test('--fields-json is validated like --add-field', t => {
  t.deepEqual(
    parse_fields_json(
      '[{"key":"p","type":"enum","options":["a"]},{"key":"s","type":"string","max_length":5}]'
    ),
    [
      { key: 'p', type: 'enum', options: ['a'] },
      { key: 's', type: 'string', max_length: 5 }
    ]
  )
  t.throws(() => parse_fields_json('{}'), { message: /array/ })
  t.throws(() => parse_fields_json('[{"key":"p","type":"enum"}]'), {
    message: /options/
  })
})

test('format_field', t => {
  t.is(
    format_field({ key: 'p', type: 'enum', options: ['a', 'b'] }),
    'p (enum: a, b)'
  )
  t.is(
    format_field({ key: 's', type: 'string', max_length: 9 }),
    's (string, max 9)'
  )
})
