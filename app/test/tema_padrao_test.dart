import 'package:clube_panda/core/app_prefs.dart';
import 'package:clube_panda/core/ui_prefs.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<ThemeMode> temaCom(Map<String, Object> salvo) async {
  SharedPreferences.setMockInitialValues(salvo);
  final prefs = await SharedPreferences.getInstance();
  final c = ProviderContainer(
    overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
  );
  addTearDown(c.dispose);
  return c.read(themeModeProvider);
}

void main() {
  test('sem escolha salva abre no escuro', () async {
    expect(await temaCom({}), ThemeMode.dark);
  });

  test('escolha do usuário continua valendo', () async {
    expect(await temaCom({'theme_mode': 'claro'}), ThemeMode.light);
    expect(await temaCom({'theme_mode': 'sistema'}), ThemeMode.system);
    expect(await temaCom({'theme_mode': 'escuro'}), ThemeMode.dark);
  });
}
