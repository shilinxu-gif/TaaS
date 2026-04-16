package com.taas.infra.db;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface DbHealthMapper {
  @Select("select 1")
  int ping();
}
