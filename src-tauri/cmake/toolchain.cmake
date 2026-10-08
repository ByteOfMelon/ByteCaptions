# Passed to whisper.cpp's CMake build as CMAKE_TOOLCHAIN_FILE (from .cargo/config.toml).
# Fixes two problems with building it on Windows through the cmake crate.

if(CMAKE_HOST_WIN32 AND DEFINED ENV{TEMP})
	# The Vulkan backend builds its shader compiler as a nested CMake project inside Cargo's
	# already deep OUT_DIR, which pushes MSBuild past Windows' 260-character path limit ("No
	# CMAKE_C_COMPILER could be found"). Build nested projects under a short folder in %TEMP%
	# instead, one per build directory so debug and release builds don't collide.
	string(MD5 _bc_hash "${CMAKE_BINARY_DIR}")
	string(SUBSTRING "${_bc_hash}" 0 10 _bc_hash)
	file(TO_CMAKE_PATH "$ENV{TEMP}/bc-cmake/${_bc_hash}" _bc_ep_base)
	set_property(DIRECTORY PROPERTY EP_BASE "${_bc_ep_base}")
endif()

if(CMAKE_GENERATOR MATCHES "Visual Studio")
	# With the Visual Studio generator the cmake crate replaces CMAKE_<LANG>_FLAGS_<type> with
	# its own flags minus optimization ones, and whisper-rs-sys asks for a Release build in
	# release mode, so release builds of whisper.cpp ended up unoptimized (CPU transcription
	# about 15x slower). Put CMake's usual Release flags back.
	set(CMAKE_C_FLAGS_RELEASE "/MD /O2 /Ob2 /DNDEBUG" CACHE STRING "" FORCE)
	set(CMAKE_CXX_FLAGS_RELEASE "/MD /O2 /Ob2 /DNDEBUG" CACHE STRING "" FORCE)
endif()
